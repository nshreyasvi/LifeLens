#!/usr/bin/env bash
# One-time setup inside WSL2 Ubuntu (or any Linux box with an NVIDIA GPU).
#   bash setup.sh                       # omniegocap mhr hawor vlm
#   bash setup.sh dam                   # optional: Describe Anything (+ SAM 2.1)
#
# Five conda envs because the upstream pins conflict:
#   omniegocap  py3.11  OmniEgoCap (theseus, scikit-sparse) + ffmpeg
#   hawor       py3.10  HaWoR hand model + masked DROID-SLAM + Metric3D
#   mhr         py3.12  renderer (pyrender); also Meta MHR for the optional pipeline/to_mhr.py
#   vlm         py3.11  Qwen3-VL-2B narration (transformers 5)
#   dam         py3.10  NVIDIA Describe Anything + SAM 2.1 (transformers 4.46, numpy < 2)
#
# Licensed files you must download yourself (free registration at https://mano.is.tue.mpg.de):
#   SMPL-H "Extended SMPL+H model" smplh.tar.xz:
#     tar -xJf smplh.tar.xz -O neutral/model.npz > third_party/OmniEgoCap/data/smplh/SMPLH_NEUTRAL.npz
#   MANO mano_v1_2.zip: models/MANO_RIGHT.pkl -> third_party/HaWoR/_DATA/data/mano/
#                       models/MANO_LEFT.pkl  -> third_party/HaWoR/_DATA/data_left/mano_left/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TP="$ROOT/third_party"
CONDA_ROOT="${CONDA_ROOT:-$HOME/anaconda3}"
CUDA_HOME="${CUDA_HOME:-/usr/local/cuda-12.6}"
export TORCH_CUDA_ARCH_LIST="${TORCH_CUDA_ARCH_LIST:-8.9}"   # RTX 40xx; use "8.6" for RTX 30xx
source "$CONDA_ROOT/etc/profile.d/conda.sh"
mkdir -p "$TP"

clone() {  # clone <dir> <url> <commit>: pinned, the pipeline calls some of their internals
  [ -d "$TP/$1" ] || { git clone "$2" "$TP/$1" && git -C "$TP/$1" checkout -q "$3" && git -C "$TP/$1" submodule update -q --init --recursive; }
}
mkenv() { conda env list | grep -q "^$1 " || conda create -y -n "$1" -c conda-forge --override-channels "${@:2}"; }

setup_omniegocap() {
  clone OmniEgoCap https://github.com/KyungWonCho/OmniEgoCap.git fdcbd4a4497d8816b1d16ef4e0322f699cbea12b
  mkenv omniegocap python=3.11 suitesparse mpi4py ffmpeg cython numpy
  conda activate omniegocap
  pip install torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cu126
  SUITESPARSE_INCLUDE_DIR="$CONDA_PREFIX/include/suitesparse" SUITESPARSE_LIBRARY_DIR="$CONDA_PREFIX/lib" \
    pip install --no-build-isolation scikit-sparse==0.4.16
  pip install -r "$TP/OmniEgoCap/requirements.txt"
  pip install -e "$TP/OmniEgoCap"
  CUDA_HOME="$CUDA_HOME" PATH="$CUDA_HOME/bin:$PATH" \
    pip install --no-build-isolation "git+https://github.com/facebookresearch/theseus.git"
  pip install gdown huggingface_hub
  mkdir -p "$TP/OmniEgoCap/checkpoints" "$TP/OmniEgoCap/data/smplh"
  [ -f "$TP/OmniEgoCap/checkpoints/omniegocap.pt" ] || \
    gdown 1DqF8a-aKGl_wih1jwcqcaZO0k_-1zF7f -O "$TP/OmniEgoCap/checkpoints/omniegocap.pt"
  conda deactivate
}

setup_mhr() {
  clone MHR https://github.com/facebookresearch/MHR.git dd4340315901ba2e367133b86971e0caf8e91dd5
  # pymomentum 0.1.90 = MHR's pixi lock; the PyPI pymomentum-gpu 0.1.114 wheel segfaults while loading the MHR rig
  mkenv mhr python=3.12 "pymomentum=0.1.90=cuda129*" "numpy<2.4" trimesh scikit-learn tqdm
  conda activate mhr
  pip install smplx pyrender imageio imageio-ffmpeg pillow
  pip install PyOpenGL==3.1.7   # pyrender pins 3.1.0, which breaks EGL offscreen rendering
  pip install --no-deps -e "$TP/MHR"
  (cd "$TP/MHR" && [ -f assets/lod1.fbx ] || mhr-download-assets)
  conda deactivate
}

setup_hawor() {
  clone HaWoR https://github.com/ThunderVVV/HaWoR.git 66c7d4108d58a716deccd192cb7645170cdc7bd7
  # HaWoR allocates all hand masks of a video as float64: 52 GB for 105 s of 1080p. Booleans give the same result.
  sed -i -e 's/    model_masks = np.zeros((len(imgfiles), H, W))$/    model_masks = np.zeros((len(imgfiles), H, W), dtype=bool)/' \
    -e 's/^    model_masks = model_masks > 0 # bool$/    model_masks = model_masks if model_masks.dtype == bool else model_masks > 0/' \
    "$TP/HaWoR/scripts/scripts_test_video/hawor_video.py"
  mkenv hawor python=3.10 ffmpeg
  conda activate hawor
  pip install torch==2.4.1 torchvision==0.19.1 --index-url https://download.pytorch.org/whl/cu124
  pip install torch-scatter -f https://data.pyg.org/whl/torch-2.4.0+cu124.html
  # old sdists (mmcv 1.3.9, chumpy, ...) need pkg_resources, gone from setuptools >= 81: build them in this env
  pip install "setuptools<70" wheel cython numpy==1.26.4
  grep -v -E "pytorch3d|torch-scatter|chumpy" "$TP/HaWoR/requirements.txt" > "$TP/hawor_req.txt"
  pip install --no-build-isolation -r "$TP/hawor_req.txt"
  pip install --no-build-isolation "git+https://github.com/mattloper/chumpy"
  CUDA_HOME="$CUDA_HOME" PATH="$CUDA_HOME/bin:$PATH" \
    pip install --no-build-isolation "git+https://github.com/facebookresearch/pytorch3d.git@stable"
  pip install pytorch-lightning==2.2.4 --no-deps
  pip install lightning-utilities torchmetrics==1.4.0 gdown
  (cd "$TP/HaWoR/thirdparty/DROID-SLAM" && CUDA_HOME="$CUDA_HOME" PATH="$CUDA_HOME/bin:$PATH" python setup.py install)
  cd "$TP/HaWoR"
  mkdir -p weights/external weights/hawor/checkpoints thirdparty/Metric3D/weights
  [ -f weights/external/detector.pt ] || wget -q https://huggingface.co/spaces/rolpotamias/WiLoR/resolve/main/pretrained_models/detector.pt -P weights/external/
  [ -f weights/hawor/checkpoints/hawor.ckpt ] || wget -q https://huggingface.co/ThunderVVV/HaWoR/resolve/main/hawor/checkpoints/hawor.ckpt -P weights/hawor/checkpoints/
  [ -f weights/hawor/checkpoints/infiller.pt ] || wget -q https://huggingface.co/ThunderVVV/HaWoR/resolve/main/hawor/checkpoints/infiller.pt -P weights/hawor/checkpoints/
  [ -f weights/hawor/model_config.yaml ] || wget -q https://huggingface.co/ThunderVVV/HaWoR/resolve/main/hawor/model_config.yaml -P weights/hawor/
  [ -f weights/external/droid.pth ] || gdown 1PpqVt1H4maBa_GbPJp4NwxRsd9jk-elh -O weights/external/droid.pth
  [ -f thirdparty/Metric3D/weights/metric_depth_vit_large_800k.pth ] || \
    gdown 1eT2gG-kwsVzNy5nJrbm4KC-9DbNKyLnr -O thirdparty/Metric3D/weights/metric_depth_vit_large_800k.pth
  cd "$ROOT"
  conda deactivate
}

setup_vlm() {
  mkenv vlm python=3.11
  conda activate vlm
  pip install torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cu126
  pip install "transformers>=4.57" accelerate opencv-python-headless pillow
  python -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3-VL-2B-Instruct')"
  conda deactivate
}

setup_dam() {
  mkenv dam python=3.10
  conda activate dam
  pip install torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cu124
  pip install "git+https://github.com/NVlabs/describe-anything" "transformers==4.46.3" "numpy<2"
  SAM2_BUILD_CUDA=0 pip install --no-build-isolation "git+https://github.com/facebookresearch/sam2.git"
  mkdir -p "$TP/sam2"
  [ -f "$TP/sam2/sam2.1_hiera_small.pt" ] || \
    wget -q https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt -P "$TP/sam2/"
  python -c "from huggingface_hub import snapshot_download; snapshot_download('nvidia/DAM-3B-Video')"
  conda deactivate
}

for env in "${@:-omniegocap mhr hawor vlm}"; do
  for e in $env; do "setup_$e"; done
done

echo "Done. Still needed by hand (licensed): SMPL-H and MANO, see the top of this file."

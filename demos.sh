#!/usr/bin/env bash
# The three OmniEgoDB GoPro demos: the authors' input.npz for the body, HaWoR for the fingers, narration and DAM.
# Needs omniegodb/gopro/<sequence>/{input.npz,camera.json} and the <sequence>.MP4 videos in this folder (README "Demos").
source "${CONDA_ROOT:-$HOME/anaconda3}/etc/profile.d/conda.sh" && conda activate omniegocap
cd "$(dirname "$0")"
for pair in outdoor:S04_outdoor_1 office:S03_office_1 robothome:S03_robothome_1; do
  name=${pair%%:*}; seq=${pair#*:}
  focal=$(python -c "import json; c = json.load(open('omniegodb/gopro/$seq/camera.json')); print(c['fx'] * 1920 / c['width'])")
  mkdir -p runs/$name
  python pipeline/run.py $seq.MP4 $name --input_npz omniegodb/gopro/$seq/input.npz --focal $focal --device gopro --dam \
    > runs/$name/run.log 2>&1
  echo "== $name: exit $?"
  cat runs/$name/timings.tsv
done

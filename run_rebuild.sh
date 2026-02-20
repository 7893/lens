#!/bin/bash
for offset in $(seq 0 100 19400); do
  for i in 0 10 20 30 40 50 60 70 80 90; do
    o=$((offset + i))
    [ $o -le 19400 ] && curl -s "https://lens.53.workers.dev/api/rebuild-embeddings?limit=10&offset=$o" &
  done
  wait
  echo "$(date +%H:%M:%S) batch $offset"
done
echo "DONE $(date)"

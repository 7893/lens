#!/bin/bash
# Lens Analytics Engine Dashboard
# Usage: ./scripts/ae-stats.sh

source ~/.env

query() {
  curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/ed3e4f0448b71302675f2b436e5e8dd3/analytics_engine/sql" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: text/plain" \
    -d "$1"
}

echo "=== Lens Analytics Engine Dashboard ==="
echo ""

echo "📊 Event Summary (All Time)"
query 'SELECT blob1 as event, count() as cnt, round(avg(double1),0) as avg_ms FROM "lens-ae" GROUP BY blob1 ORDER BY cnt DESC' | \
  python3 -c "import sys,json; d=json.load(sys.stdin)['data']; [print(f\"  {r['event']:25} {r['cnt']:>6}x  avg {r['avg_ms']:>6}ms\") for r in d]"

echo ""
echo "🔍 Top Search Queries"
query 'SELECT blob2 as query, count() as cnt, round(avg(double2),1) as avg_results FROM "lens-ae" WHERE blob1 = '\''search_complete'\'' AND blob2 != '\'''\'' GROUP BY query ORDER BY cnt DESC LIMIT 10' | \
  python3 -c "import sys,json; d=json.load(sys.stdin)['data']; [print(f\"  {r['query'][:30]:30} {r['cnt']:>4}x  ~{r['avg_results']} results\") for r in d]"

echo ""
echo "⚠️  Recent Errors"
query 'SELECT blob1 as event, blob2 as context, count() as cnt FROM "lens-ae" WHERE blob1 LIKE '\''%error%'\'' GROUP BY blob1, blob2 ORDER BY cnt DESC LIMIT 5' | \
  python3 -c "import sys,json; d=json.load(sys.stdin)['data']; [print(f\"  {r['event']:20} {r['context'][:40]:40} {r['cnt']}x\") for r in d] if d else print('  None')"

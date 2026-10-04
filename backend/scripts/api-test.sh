#!/usr/bin/env bash
# End-to-end API check. Backend must be running: npm run dev
BASE=${BASE:-http://localhost:5000/api}
j() { curl -s -H 'Content-Type: application/json' "$@"; echo; }

echo "== health";            j $BASE/health
echo "== start trace";       T=$(j -X POST $BASE/traces -d '{"projectId":"pulsetrace","rootService":"api-gateway","route":"/api/orders","method":"POST"}'); echo "$T"
TID=$(echo "$T" | sed -E 's/.*"traceId":"([^"]+)".*/\1/')
echo "traceId=$TID"
echo "== root span";         R=$(j -X POST $BASE/spans -d "{\"projectId\":\"pulsetrace\",\"traceId\":\"$TID\",\"serviceName\":\"api-gateway\",\"operation\":\"POST /api/orders\"}"); echo "$R"
ROOT=$(echo "$R" | sed -E 's/.*"spanId":"([^"]+)".*/\1/')
echo "== child span (ok)";   j -X POST $BASE/spans -d "{\"projectId\":\"pulsetrace\",\"traceId\":\"$TID\",\"parentSpanId\":\"$ROOT\",\"serviceName\":\"auth-service\",\"operation\":\"verify\",\"duration\":35}"
echo "== child span (error)"; C=$(j -X POST $BASE/spans -d "{\"projectId\":\"pulsetrace\",\"traceId\":\"$TID\",\"parentSpanId\":\"$ROOT\",\"serviceName\":\"mission-service\",\"operation\":\"create\",\"duration\":120,\"status\":\"error\",\"error\":{\"type\":\"DatabaseTimeout\",\"message\":\"db timed out\"}}"); echo "$C"
echo "== bad parent (expect 404)"; j -X POST $BASE/spans -d "{\"projectId\":\"pulsetrace\",\"traceId\":\"$TID\",\"parentSpanId\":\"sp_nope\",\"serviceName\":\"x\",\"operation\":\"y\",\"duration\":1}"
echo "== finish root span";  j -X PATCH $BASE/spans/$ROOT/finish -d '{"projectId":"pulsetrace","status":"error"}'
echo "== complete trace";    j -X POST $BASE/traces/$TID/complete -d '{"projectId":"pulsetrace"}'
echo "== trace tree";        j "$BASE/traces/$TID/tree?projectId=pulsetrace"
echo "== tree from the WRONG project (expect 404)"; j "$BASE/traces/$TID/tree?projectId=api-suite"
echo "== projects";          j $BASE/projects
echo "== spans by trace";    j "$BASE/spans/trace/$TID?projectId=pulsetrace"
echo "== errors";            j "$BASE/errors?service=mission-service"
echo "== performance";       j "$BASE/performance?projectId=pulsetrace"
echo "== service map";       j "$BASE/service-map?projectId=pulsetrace"

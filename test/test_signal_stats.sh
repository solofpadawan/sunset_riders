#!/bin/bash
# signal.php usage log + ?a=stats (pt94u): host, roster via meta, join, relay, ice, guest leave, host end, expire;
# no raw IPs; stats 200 with key / 403 wrong or missing key; private rooms not listed; fake turn_config with a test key.
set -e; D=$(mktemp -d); cp "$(dirname "$0")/../web/net/signal.php" $D/
echo "<?php return ['stats_key' => 'testkey123'];" > $D/turn_config.php
P=$((20000 + RANDOM % 20000)); PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:$P -t $D >$D/log 2>&1 & S=$!; trap "kill $S; rm -rf $D" EXIT; sleep 1
U=http://127.0.0.1:$P/signal.php; ok=1; chk() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; ok=0; fi; }
q() { python3 -c 'import urllib.parse,json,sys;print(urllib.parse.quote(json.dumps(json.loads(sys.argv[1]))))' "$1"; }
curl -s -XPOST "$U?a=host&room=WEST&id=hostaaaa" >/dev/null
curl -s "$U?a=poll&room=WEST&id=hostaaaa&meta=$(q '{"n":"Saulo","p":1,"s":0,"st":"Fase 1","pv":0,"pl":["Saulo"],"sp":[]}')" >/dev/null
curl -s "$U?a=poll&room=WEST&id=hostaaaa&meta=$(q '{"n":"Saulo","p":1,"s":0,"st":"Fase 1","pv":0,"pl":["Saulo"],"sp":[]}')" >/dev/null
curl -s -XPOST "$U?a=join&room=WEST&id=guestbbb" >/dev/null
curl -s "$U?a=ice" >/dev/null
curl -s "$U?a=ice&relay=1&room=WEST" >/dev/null
curl -s "$U?a=poll&room=WEST&id=hostaaaa&meta=$(q '{"n":"Saulo","p":2,"s":1,"st":"Fase 2","pv":0,"pl":["Saulo","Amigo"],"sp":["Zé"]}')" >/dev/null
curl -s -XPOST "$U?a=host&room=PRIV&id=hostcccc" >/dev/null
curl -s "$U?a=poll&room=PRIV&id=hostcccc&meta=$(q '{"n":"Ana","p":1,"s":0,"pv":1,"pl":["Ana"],"sp":[]}')" >/dev/null
chk "private room with meta not listed" "! curl -s '$U?a=list' | grep -q PRIV"
chk "public room listed" "curl -s '$U?a=list' | grep -q WEST"
curl -s -XPOST "$U?a=leave&room=WEST&id=guestbbb" >/dev/null
curl -s -XPOST "$U?a=leave&room=WEST&id=hostaaaa" >/dev/null
L=$(cat $D/rooms/_log/*.log); echo "$L"
chk "events logged" "for e in host roster join ice relay leave end; do echo \"\$L\" | grep -q \"\\\"e\\\":\\\"\$e\\\"\" || exit 1; done"
chk "roster logged only on change (2 for WEST)" "[ \$(echo \"\$L\" | grep -c '\"roster\",.*\"room\":\"WEST\"\\|\"e\":\"roster\".*WEST') -eq 2 ]"
chk "no raw IP" "! grep -rq 127.0.0.1 $D/rooms/_log"
chk "end has duration + names + relay" "echo \"\$L\" | grep '\"e\":\"end\"' | grep -q '\"dur\":.*Amigo.*\"r\":1'"
# expire: age PRIV past TTL, force cleanup
touch -d '-20 min' $D/rooms/PRIV/.alive; for i in $(seq 60); do curl -s "$U?a=poll&room=ZZZZ&id=nobody1" >/dev/null; done
chk "expired room logged" "grep -q '\"e\":\"expire\",.*PRIV' $D/rooms/_log/*.log"
chk "_log survives cleanup" "[ -f $D/rooms/_log/salt ]"
chk "stats 200 with key" "[ \$(curl -s -o $D/s.html -w '%{http_code}' '$U?a=stats&k=testkey123') = 200 ] && grep -q 'Salas recentes' $D/s.html && grep -q 'Amigo' $D/s.html"
chk "stats 403 wrong key" "[ \$(curl -s -o /dev/null -w '%{http_code}' '$U?a=stats&k=nope') = 403 ]"
chk "stats 403 no key" "[ \$(curl -s -o /dev/null -w '%{http_code}' '$U?a=stats') = 403 ]"
chk "stats json" "curl -s '$U?a=stats&k=testkey123&fmt=json' | python3 -c 'import json,sys;j=json.load(sys.stdin);assert j[\"periodos\"][\"hoje\"][\"salas\"]==2 and j[\"periodos\"][\"hoje\"][\"salas_com_relay\"]==1, j[\"periodos\"]'"
grep -i 'warn\|deprec\|fatal' $D/log && ok=0
[ $ok = 1 ] && echo ALL PASS || { echo SOME FAILED; exit 1; }

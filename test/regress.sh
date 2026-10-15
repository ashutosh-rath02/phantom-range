#!/bin/bash
# Full regression: unit gestures, live gesture scenarios, tutorial, gameplay, single-file build.
cd /home/claude/phantom-range/test
F='agent-proxy|allowed hosts|for details|fonts.google|Allowed hosts'
echo "== unit"; node gesture_unit.mjs 2>/dev/null | tail -1; node trigger_unit.mjs 2>/dev/null | tail -1
echo "== basic scenario"; timeout 300 node run_scenario.mjs --script scenario_slow2.json --secs 52 --w 960 --h 540 --tag r_basic 2>&1 | grep -E "gesture fire|shots|errors:"
echo "== tutorial"; timeout 300 node run_scenario.mjs --script scenario_tut2.json --url "http://localhost:8080/public/index.html?autostart=tutorial&cpu=1" --secs 55 --w 960 --h 540 --tag r_tut 2>&1 | grep -E "gesture fire|shots|errors:"
python3 -c "
import json; d=json.load(open('out/r_tut_log.json')); steps=[l['step'] for l in d['logs'] if l['type']=='tutorial']; modes=[l['mode'] for l in d['logs'] if l['type']=='mode']; print('tutorial steps', steps, 'modes', modes)"
echo "== gameplay"; timeout 300 node game_test.mjs 2>&1 | grep -vE "$F"
echo "== single file"; timeout 300 node cdn_test.mjs 2>&1 | grep -E "getUserMedia|state|mode"

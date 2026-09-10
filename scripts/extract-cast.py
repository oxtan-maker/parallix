import json, re, sys
evs = [json.loads(l) for l in open(sys.argv[1])]
txt = ''.join(e[2] for e in evs if isinstance(e, list) and e[1] == 'o')
txt = re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]', '', txt)
txt = re.sub(r'\x1b\][0-9];.*?\x1b\\', '', txt, flags=re.S)
txt = txt.replace('\x0c', '')
sys.stdout.write(txt[-2000:])

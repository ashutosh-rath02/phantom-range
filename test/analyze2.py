import json, math, numpy as np
d = json.load(open('landmarks.json'))
def nz(v): return v/np.linalg.norm(v)
for k,v in d.items():
    for h in v['hands']:
        w=np.array(h['wl']); ps=np.linalg.norm(w[9]-w[0])
        f=nz(w[8]-w[5]*0.5-w[6]*0.5) # index dir
        f=nz((w[8]-w[5]))
        dn=w[17]-w[5]; dn=nz(dn-np.dot(dn,f)*f); up=-dn
        side=np.cross(f,up)
        hgt=np.dot(w[4]-w[5],up)/ps; fw=np.dot(w[4]-w[5],f)/ps; sd=np.dot(w[4]-w[5],side)/ps
        th=nz(w[4]-w[2]); ang=math.degrees(math.acos(np.clip(np.dot(th,f),-1,1)))
        thup=np.dot(th,up)
        print(f"{k:20s} h={hgt:+.2f} fwd={fw:+.2f} side={sd:+.2f} thumbAngIdx={ang:5.0f} thumbUp={thup:+.2f}")

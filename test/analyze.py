import json, math, numpy as np
d = json.load(open('landmarks.json'))
def ext(w, f):
    ids = {'i':[5,6,7,8],'m':[9,10,11,12],'r':[13,14,15,16],'p':[17,18,19,20]}[f]
    chain = np.linalg.norm(w[ids[0]]-w[0]) + sum(np.linalg.norm(w[ids[k+1]]-w[ids[k]]) for k in range(3))
    return np.linalg.norm(w[ids[3]]-w[0])/chain
def bend(w,f):
    ids = {'i':[5,6,7,8],'m':[9,10,11,12],'r':[13,14,15,16],'p':[17,18,19,20]}[f]
    a=w[ids[1]]-w[ids[0]]; b=w[ids[2]]-w[ids[1]]; c=w[ids[3]]-w[ids[2]]; p=w[ids[0]]-w[0]
    ang=lambda u,v: math.degrees(math.acos(np.clip(np.dot(u,v)/np.linalg.norm(u)/np.linalg.norm(v),-1,1)))
    return ang(p,a)+ang(a,b)+ang(b,c)
def segdist(p,a,b):
    ab=b-a; t=np.clip(np.dot(p-a,ab)/np.dot(ab,ab),0,1); return np.linalg.norm(p-(a+t*ab))
for k,v in d.items():
    for h in v['hands']:
        w=np.array(h['wl']); l=np.array(h['lm']); img=l[:,:2]*np.array([v['W'],v['H']])
        # similarity fit world xy -> image xy
        A=w[:,:2]-w[:,:2].mean(0); B=img-img.mean(0)
        H=A.T@B; U,S,Vt=np.linalg.svd(H); R=(U@Vt).T; ang=math.degrees(math.atan2(R[1,0],R[0,0])); det=np.linalg.det(R)
        s=np.sum(B*(A@R.T))/np.sum(A*A); resid=np.linalg.norm(B-s*(A@R.T),axis=1).mean()
        # direct (no rotation) scale fit
        s0=np.sum(B*A)/np.sum(A*A); resid0=np.linalg.norm(B-s0*A,axis=1).mean()
        ps=np.linalg.norm(w[9]-w[0])
        t=segdist(w[4],w[5],w[6])/ps; t2=np.linalg.norm(w[4]-w[6])/ps
        fwd=w[8]-w[5]; fwd/=np.linalg.norm(fwd)
        print(f"{k:20s} rot={ang:6.1f} det={det:+.0f} resid={resid:5.1f} resid0={resid0:5.1f} s0={s0:6.0f} | ext i{ext(w,'i'):.2f} m{ext(w,'m'):.2f} r{ext(w,'r'):.2f} p{ext(w,'p'):.2f} | bend i{bend(w,'i'):4.0f} m{bend(w,'m'):4.0f} r{bend(w,'r'):4.0f} p{bend(w,'p'):4.0f} | thumb t={t:.2f} t2={t2:.2f} | fwd={fwd.round(2)} ps={ps*100:.1f}cm")

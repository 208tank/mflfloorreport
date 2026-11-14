# Independent hand calculations for the verification test library (no app code used).
import math
r = {}
# MRT imperial
tn=0.25; yrs=20; Or=10
bot=tn-0.180; top=0.040
UPr=bot/yrs; StPr=top/yrs
r['V01']=dict(UPr=UPr,StPr=StPr,RTbc=0.180,RTip=tn-0.040,MRT=min(0.180,tn-0.040)-Or*(UPr+StPr))
# metric
tn=6.0; UPr=(6.0-4.5)/20; StPr=1.0/20
r['V02']=dict(UPr=UPr,StPr=StPr,MRT=min(4.5,5.0)-10*(UPr+StPr))
# auto repair
tn=0.25; K_all=(0.25-0.11)/20+0.04/20
r['V03']=dict(K_before=K_all, C_proj=0.11-10*K_all, K_after=(0.25-0.18)/20+0.04/20, MRT=0.18-10*((0.25-0.18)/20+0.04/20))
# MFL est
r['V04']=dict(rem=0.25*(1-0.40))
# CZ
r['V08']=dict(czLim=max(0.1,min(0.25/2,0.30/2)), UPr=(0.25-0.15)/20, proj=0.15-10*(0.25-0.15)/20)
r['V09']=dict(czLim_mm=max(2.54,min(8/2,5/2)))
# Table 4.5 step reading for Sb=25,000 psi, t1<=0.75: columns <=24300,<=27000 -> 0.20
r['V11']=dict(step=0.20, interp=0.17+(25000-24300)/(27000-24300)*(0.20-0.17))
# shell tmin imperial
def tmin(H,D,G,S,E): return max(2.6*(H-1)*D*G/(S*E),0.1)
r['V13']=dict(c1=tmin(40,100,1.0,23600,1.0), c2=tmin(32,100,1.0,23600,1.0), c3=tmin(24,100,1.0,26000,1.0), c5=tmin(8,100,1.0,26000,1.0))
# metric shell: D=30 m, fill 12 m, G 0.9, A516-60 lower Sd 25600, E 0.85
D=30000/304.8; H=12000/304.8
r['V17']=dict(D_ft=D,H_ft=H,tmin_in=tmin(H,D,0.9,25600,0.85), tmin_mm=tmin(H,D,0.9,25600,0.85)*25.4)
# allowables A36-like Y=36000 T=58000
r['V18']=dict(SdL=min(0.8*36000,0.429*58000), SdU=min(0.88*36000,0.472*58000), StL=min(0.88*36000,0.472*58000), StU=min(0.9*36000,0.519*58000))
# hydrotest height: course1 t=0.5 in, StL A516-55 = 26000, E=1, D=100 ft
r['V19']=dict(Ht_ft=26000*1.0*0.5/(2.6*100)+1, Hfill_ft=23600*1.0*0.5/(2.6*100*1.0)+1)
# settlement cosine exact: N=8, z=10+2cos+1sin
N=8; th=[2*math.pi*i/N for i in range(N)]
amp=math.hypot(2,1); hi=math.degrees(math.atan2(1,2))%360
r['V23']=dict(a=10,b=2,c=1,amp=amp,tilt=2*amp,hiDeg=hi,loDeg=(hi+180)%360,R2=1.0)
# out of plane: N=10 stations, D=100 ft, H=40 ft, z=2cos+1sin + bump 0.5 at station 3 (index 2)
import numpy as np
N=10; ang=np.array([360*i/N for i in range(N)]); z=2*np.cos(np.radians(ang))+1*np.sin(np.radians(ang)); z[2]+=0.5
A=np.vstack([np.ones(N),np.cos(np.radians(ang)),np.sin(np.radians(ang))]).T
sol,*_=np.linalg.lstsq(A,z,rcond=None); fit=A@sol; U=z-fit
S=np.array([U[i]-0.5*(U[i-1]+U[(i+1)%N]) for i in range(N)])
SST=((z-z.mean())**2).sum(); SSE=(U**2).sum()
L=math.pi*100/N; Y=30000; E=29000000; Hs=40
Smax_ft=11*L*L*Y/(2*E*Hs); 
r['V24']=dict(a=sol[0],b=sol[1],c=sol[2],R2=1-SSE/SST,S3=S[2],maxabsS=float(abs(S).max()),L_ft=L,Smax_in=Smax_ft*12)
# metric version: same geometry in mm: D=30 m, H=12 m, z in mm = 50cos+25sin, bump 12 mm at station 3
N=10; z=50*np.cos(np.radians(ang))+25*np.sin(np.radians(ang)); z[2]+=12
sol,*_=np.linalg.lstsq(A,z,rcond=None); U=z-A@sol; S=np.array([U[i]-0.5*(U[i-1]+U[(i+1)%N]) for i in range(N)])
L=math.pi*30000/N; Ym=206.8; Em=200000; Hm=12000
r['V26']=dict(S3=S[2],Smax_mm=11*L*L*Ym/(2*Em*Hm),R2=1-(U**2).sum()/((z-z.mean())**2).sum())
# alpha formula
r['V27']=dict(B45=4-(4-3)*math.sin(math.radians(45)), B20f=4-(4-3)*math.sin(math.radians(20)), B70f=4-(4-3)*math.sin(math.radians(70)))
# depression
r['V29']=dict(BB_in=0.37*10, BB_metric_mm=0.37*(3000/304.8)*25.4)
# seal
r['V32']=dict(kb_cm2m=10*6.4516/0.3048, conv=6.4516/0.3048)
r['V33']=dict(perM=(100*1+100*1)/30)
# autoN
def autoN(Dft):
    n=math.ceil(Dft/10);  n+= n%2; n=max(8,n)
    while math.pi*Dft/n>32: n+=2
    return n
r['V37']=dict(D150=autoN(150),D40=autoN(40),D330=autoN(330),D400=autoN(400))
# rect patch: len 14 in, margin 2 -> 18; wid 3 -> max(12,7)=12
r['V35']=dict(L=max(12,14+4),W=max(12,3+4))
# nozzle
r['V20']=dict(min=0.301,loss=(0.337-0.255)/0.337*100)
# ---- v3.6.0: cases changed by the approved corrections (keys use the library IDs) ----
# V-03: repaired soil-side C keeps its rate (Note 1) -> K = 0.140/20 + 0.040/20; A projected = 0.180 - 10 K
K=(0.25-0.11)/20+0.04/20; r['V-03']=dict(K=K, A_proj=0.18-10*K, A_ok=0.18-10*K>=0.10)
# V-12 / V-47 / V-13: §4.4.5.4 limit = max(floor, min(cap, 0.5 x course-1 t-min))
r['V-12']=dict(czLim_in=max(0.10,min(0.118,0.30/2))); r['V-47']=dict(czLim_in=max(0.10,min(0.118,0.40/2))); r['V-13']=dict(czLim_mm=max(2.5,min(3.0,5/2)))
# V-48: UPr thickness = lesser of the MFL threshold (40 % -> 0.150 in) and the thinnest unrepaired area (0.200 in)
r['V-48']=dict(UPr=(0.25-min(0.25*0.6,0.20))/20)
# V-20: SI form, A516M-415 lower courses S = 177 MPa
r['V-20']=dict(tmin_mm=max(4.9*30*(12-0.3)*0.9/(177*0.85),2.5))
# V-42: SI form of B.3.3
r['V-42']=dict(BB_mm=0.031*3000)
# V-51: H 75 ft, G 1, t 1.00 in, D such that Sb = 30,000 psi
D=30000/(2.6*74); r['V-51']=dict(D_ft=D, Sb=2.6*D*74*1.0/1.0, t=9/32)
for k,v in r.items(): print(k, {kk:(round(float(vv),6) if isinstance(vv,(int,float,np.floating)) else vv) for kk,vv in v.items()})

// Generate the scripted stage-1 input movie (5 bytes/frame, active-high: P1,P2,P3,P4,COINS; see run/record_attract.lua).
// Usage: node tools/make_movie.js out.bin [frames=3000]
const fs=require('fs');
const out=process.argv[2]||'ref/movie/movie.bin', N=+(process.argv[3]||3000);
const L=1,R=2,U=4,D=8,B1=16,B2=32;
const buf=Buffer.alloc(N*5);
for(let n=1;n<=N;n++){
  let p1=0,c=0;
  if(n>=600&&n<606) c|=1;                       // coin 1
  if(n>=700){
    if(n%8<3) p1|=B1;                            // shoot (first press = start)
    if(n%600<520) p1|=R; else if(n%600<560) p1|=L;
    if(n%120<4) p1|=B2;                          // jump
    if(n%240>=120&&n%240<160) p1|=U;             // aim up
    if(n%300>=200&&n%300<215) p1|=D;             // duck
  }
  buf[(n-1)*5]=p1; buf[(n-1)*5+4]=c;
}
fs.writeFileSync(out,buf); console.log('wrote',out,N,'frames');

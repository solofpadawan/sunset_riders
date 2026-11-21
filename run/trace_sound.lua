-- Sound-side trace (SSR_LAST frames, default 600) into SSR_OUT (default /tmp/snd.log). One line per access:
--   <frame> <time_ns> <who> <r|w> <addr> <data>
-- who: m = 68000 (0x5c0600-0x5c0605), z = Z80 (0xf800-0xfc00: YM2151, K053260, NMI arm). Time is machine time in ns.
local last=tonumber(os.getenv("SSR_LAST") or "600")
local out=assert(io.open(os.getenv("SSR_OUT") or "/tmp/snd.log","w"))
local m=manager.machine
local mp=m.devices[":maincpu"].spaces["program"]
local zp=m.devices[":audiocpu"].spaces["program"]
local n=0
local function t() local x=m.time return string.format("%.0f", x.seconds*1e9 + x.attoseconds/1e9) end
local function lg(who,rw,a,d) out:write(string.format("%d %s %s %s %x %x\n",n,t(),who,rw,a,d)) end
local zr = os.getenv("SSR_ZREAD")
local play=nil local held={}
if os.getenv("SSR_PLAY") then play=dofile(os.getenv("SSR_PLAY")) end
local function set(port,field,v) local f=m.ioport.ports[port].fields[field] if v~=0 then f:set_value(1) else f:clear_value() end end
t1=mp:install_write_tap(0x5c0600,0x5c0605,"mw",function(a,d,mk) lg("m","w",a,d) end)
t2=mp:install_read_tap(0x5c0600,0x5c0603,"mr",function(a,d,mk) lg("m","r",a,d) end)
t3=zp:install_write_tap(0xf800,0xfc00,"zw",function(a,d,mk) lg("z","w",a,d) end)
if zr then t4=zp:install_read_tap(0xf800,0xfa2f,"zr",function(a,d,mk) lg("z","r",a,d) end) end
-- SSR_MOVIE=file: same input movie format/timing as record_attract.lua
local movie=nil
if os.getenv("SSR_MOVIE") then local mf=assert(io.open(os.getenv("SSR_MOVIE"),"rb")) movie=mf:read("a") mf:close() end
local FN={"Left","Right","Up","Down","Button 1","Button 2"}
local function apply(k)
  local o=(k-1)*5 if not movie or o+5>#movie then return end
  for p=1,4 do local b=movie:byte(o+p) local port=m.ioport.ports[":P"..p]
    for i,nm in ipairs(FN) do local f=port.fields["P"..p.." "..nm] if f then if (b>>(i-1))&1==1 then f:set_value(1) else f:clear_value() end end end end
  local c=movie:byte(o+5) local cp=m.ioport.ports[":COINS"]
  for i=1,4 do local f=cp.fields["Coin "..i] if f then if (c>>(i-1))&1==1 then f:set_value(1) else f:clear_value() end end end
  local sv=cp.fields["Service 1"] if sv then if (c>>4)&1==1 then sv:set_value(1) else sv:clear_value() end end
end
emu.register_frame_done(function() n=n+1 if play then play(n,set,mp) end apply(n) if n>=last then out:close() m:exit() end end)

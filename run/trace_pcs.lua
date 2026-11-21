-- Trace all 68k instructions during frame windows SSR_WIN="a-b,c-d" into SSR_TRACE (MAME debugger trace file).
local wins={} for a,b in (os.getenv("SSR_WIN") or "4176-4180"):gmatch("(%d+)-(%d+)") do wins[#wins+1]={tonumber(a),tonumber(b)} end
local out=os.getenv("SSR_TRACE") or "/tmp/trace"
local m=manager.machine local n=0 local on=false local last=0 for _,w in ipairs(wins) do if w[2]>last then last=w[2] end end
emu.register_frame_done(function() n=n+1
  local want=false for i,w in ipairs(wins) do if n>=w[1]-1 and n<w[2] then want=i end end
  if want and not on then m.debugger:command("trace "..out.."_"..want..".log,maincpu,noloop") on=true
  elseif not want and on then m.debugger:command("trace off,maincpu") on=false end
  if n>=last then m:exit() end end)

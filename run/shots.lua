local frames={} for _,f in ipairs({60,300,600,900,1200,1500,1800,2100,2400,3000,3600}) do frames[f]=1 end
local extra=os.getenv("SSR_FRAMES") if extra then frames={} for f in extra:gmatch("%d+") do frames[tonumber(f)]=1 end end
local last=0 for f in pairs(frames) do if f>last then last=f end end
local n=0
emu.register_frame_done(function()
  n=n+1
  if frames[n] then manager.machine.video:snapshot() print("SHOT "..n) end
  if n>=last then manager.machine:exit() end
end)

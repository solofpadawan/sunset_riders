local n=0
emu.register_frame_done(function()
  n=n+1
  if n==120 then
    local s=manager.machine.screens:at(1)
    print(string.format("LUA_OK frame=%d screen=%s refresh=%.6f", s:frame_number(), s.tag, 1/s.frame_period))
    manager.machine:exit()
  end
end)

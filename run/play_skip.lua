-- Coin+start, then use known MAME cheat pokes (mamecheat.co.uk forum, ssriders):
--   "Finish this Stage Now!": if pb@104005 == 4 (in stage) -> write 5   (applied SSR_SKIPEVERY frames after entering a stage, default 700)
--   "Infinite Time": pb@104315 = 0 every frame
-- Inputs: shoot/advance right so the stage keeps scrolling between skips. SSR_NOSKIP=1 disables the skip (play only).
local every = tonumber(os.getenv("SSR_SKIPEVERY") or "700")
local noskip = os.getenv("SSR_NOSKIP") == "1"
local instage = 0
return function(n, set, prog)
  if n % 900 == 600 then set(":COINS","Coin 1",1) elseif n % 900 == 606 then set(":COINS","Coin 1",0) end
  if n < 700 then return end
  set(":P1","P1 Button 1", (n % 8 < 3) and 1 or 0)
  set(":P1","P1 Right", ((n % 600) < 520) and 1 or 0)
  set(":P1","P1 Button 2", (n % 120 < 4) and 1 or 0)
  prog:write_u8(0x104315, 0)
  if prog:read_u8(0x104005) == 4 then
    instage = instage + 1
    if not noskip and instage == every then prog:write_u8(0x104005, 5) print("SKIP "..n) end
  else instage = 0 end
end

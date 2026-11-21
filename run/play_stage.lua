-- Scripted 1P run: coin+start, then run right shooting and jumping; re-coin every 900 frames to continue.
-- (ssriders 4P set: Coin N credits slot N, P1 Button 1 = start/shoot, Button 2 = jump)
local hold_right = os.getenv("SSR_RIGHT") ~= "0"
return function(n, set, prog)
  if n % 900 == 600 then set(":COINS","Coin 1",1) elseif n % 900 == 606 then set(":COINS","Coin 1",0) end
  if n < 700 then return end
  set(":P1","P1 Button 1", (n % 8 < 3) and 1 or 0)
  set(":P1","P1 Right", hold_right and ((n % 600) < 520) and 1 or 0)
  set(":P1","P1 Left", 0)
  set(":P1","P1 Button 2", (n % 120 < 4) and 1 or 0)
  set(":P1","P1 Up", (n % 240 >= 120 and n % 240 < 160) and 1 or 0)
end

-- Dump video state at given frames (SSR_FRAMES env, default "3800 4300") into SSR_OUT (default ref/dump):
--  fNNNN_pal.bin (0x1000, palette RAM, xBGR555 little-endian words), fNNNN_k052109.bin (0x6000 RAM),
--  fNNNN_k052109_regs.bin (charrombank[4], charrombank_2[4], addrmap, tileflip, scrollctrl, romsubbank),
--  fNNNN_k053251.bin (16 regs), fNNNN_k053244.bin (16 regs), fNNNN_k053245_buf.bin (0x800 sprite buffer, as latched at reg 6 write, BE words; _buf_prev = latch at previous frame end),
--  fNNNN_k053245_ram.bin (live), fNNNN_misc.bin (dim_c = last 0x1c0200 low byte & 0x18, dim_v = (0x1c0300 low byte >> 4) & 7),
--  plus a MAME snapshot (snapname %g/%i).
-- Optional: SSR_PLAY=run/play_xxx.lua (returns function(frame, set) that drives inputs; set(port, field, 0/1)),
--           SSR_POKE ditto via the same script (it gets prog as 3rd arg),
--           SSR_SCAN=1 prints one "SCAN" line per frame whose renderer-relevant features change
--           (shadow sprites, k053251 reg5/6, dim_c/dim_v, scrollctrl), SSR_LAST=N to run on past the last dump frame.
local out=os.getenv("SSR_OUT") or "ref/dump"
local frames={} local last=0
for f in (os.getenv("SSR_FRAMES") or "3800 4300"):gmatch("%d+") do f=tonumber(f) frames[f]=1 if f>last then last=f end end
if os.getenv("SSR_LAST") then last=math.max(last,tonumber(os.getenv("SSR_LAST"))) end
local m=manager.machine
local prog=m.devices[":maincpu"].spaces["program"]
local spr=m.memory.shares[":spriteram"]
local regs44={} for i=0,15 do regs44[i]=0 end
local function k053245_ram()
  local t={}
  for i=0,0x3ff do -- chip word i <- spriteram word offset with A1,A5,A6 =0
    local off=((i&7)<<1)|((i&0x3f8)<<3)
    local w=prog:read_u16(0x180000+off*2) -- via k053245_word_r: ssriders protection writes chip RAM directly, :spriteram share is stale
    t[#t+1]=string.char(w>>8,w&0xff)
  end
  return table.concat(t)
end
local buf=string.rep("\0",0x800)
tap44=prog:install_write_tap(0x5a0000,0x5a001f,"k053244",function(addr,data,mask)
  local off=((addr-0x5a0000)>>1)&~1
  if mask&0xff00~=0 then regs44[off]=(data>>8)&0xff if off==6 then local ok,r=pcall(k053245_ram) if ok then buf=r else print("ERR",r) end end end
  if mask&0x00ff~=0 then regs44[off+1]=data&0xff if off+1==6 then buf=k053245_ram() end if off+1==7 then buf=string.rep("\0",0x800) end end
end)
local dim_c,dim_v=0,0
tapdim1=prog:install_write_tap(0x1c0200,0x1c0201,"dimc",function(a,d,mk) if mk&0xff~=0 then dim_c=d&0x18 end end)
tapdim2=prog:install_write_tap(0x1c0300,0x1c0301,"dimv",function(a,d,mk) if mk&0xff~=0 then dim_v=(d>>4)&7 end end)
local play=nil
if os.getenv("SSR_PLAY") then play=dofile(os.getenv("SSR_PLAY")) end
local held={}
local function set(port,field,v)
  local f=m.ioport.ports[port].fields[field]
  if v~=0 then f:set_value(1) held[f]=1 else f:clear_value() held[f]=nil end
end
local scan=os.getenv("SSR_SCAN")
local lastscan=""
local function item(dev,name) return emu.item(m.devices[dev].items[name]) end
local function dumpitem(it,n) local t={} for i=0,n-1 do t[#t+1]=string.char(it:read(i)&0xff) end return table.concat(t) end
local function wr(name,data) local f=assert(io.open(out.."/"..name,"wb")) f:write(data) f:close() end
local n=0
local prevbuf=string.rep("\0",0x800)
emu.register_frame_done(function()
  n=n+1
  if play then play(n,set,prog) end
  if scan then
    local k51=item(":k053251","0/m_ram")
    local nsh=0
    for o=0,#buf-16,16 do local w0=buf:byte(o+1)*256+buf:byte(o+2) local w6=buf:byte(o+14) if w0>=0x80 and (w6&0x80)~=0 then nsh=nsh+1 end end
    local sc=item(":k052109","0/m_scrollctrl"):read(0)
    local key=string.format("r5=%02x r6=%02x dimc=%02x dimv=%d sc=%02x shadow=%s",k51:read(5),k51:read(6),dim_c,dim_v,sc,nsh>0 and "y" or "n")
    if key~=lastscan then print(string.format("SCAN %d %s nshadow=%d",n,key,nsh)) lastscan=key end
  end
  if frames[n] then
    local p=string.format("f%04d_",n)
    local t={} for i=0,0xfff do t[#t+1]=string.char(m.memory.shares[":palette"]:read_u8(i ~ 1)) end 
    wr(p.."pal.bin",table.concat(t))
    wr(p.."k052109.bin",dumpitem(item(":k052109","0/m_ram"),0x6000))
    local r={}
    for _,nm in ipairs({"0/m_charrombank","0/m_charrombank_2"}) do local it=item(":k052109",nm) for i=0,3 do r[#r+1]=string.char(it:read(i)&0xff) end end
    for _,nm in ipairs({"0/m_addrmap","0/m_tileflip_enable","0/m_scrollctrl","0/m_romsubbank"}) do r[#r+1]=string.char(item(":k052109",nm):read(0)&0xff) end
    wr(p.."k052109_regs.bin",table.concat(r))
    wr(p.."k053251.bin",dumpitem(item(":k053251","0/m_ram"),16))
    local g={} for i=0,15 do g[#g+1]=string.char(regs44[i]) end wr(p.."k053244.bin",table.concat(g))
    wr(p.."k053245_buf.bin",buf) wr(p.."k053245_buf_prev.bin",prevbuf) wr(p.."k053245_ram.bin",k053245_ram())
    wr(p.."misc.bin",string.char(dim_c,dim_v))
    m.video:snapshot() print("DUMP "..n)
  end
  prevbuf=buf
  if n>=last then m:exit() end
end)

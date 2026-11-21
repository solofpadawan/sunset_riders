"""Layout of run/record_attract.lua records (one per frame, frame n = record n-1)."""
import numpy as np
FIELDS = [('pal', 0x1000), ('k052109', 0x6000), ('k052109_regs', 12), ('k053251', 16), ('k053244', 16), ('k053245_buf', 0x800), ('misc', 2)]
REC = sum(n for _, n in FIELDS)
OFF = {}; _o = 0
for k, n in FIELDS: OFF[k] = (_o, _o + n); _o += n
def load(path='ref/attract/state.bin'):
    return np.memmap(path, np.uint8, 'r').reshape(-1, REC)
def field(rec, k): a, b = OFF[k]; return rec[..., a:b]

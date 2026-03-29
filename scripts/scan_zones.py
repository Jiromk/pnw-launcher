import sys, struct
sys.path.insert(0, r'C:\Users\lamou\Documents\pnw-launcher')
from marshal_reader import MarshalReader

# 1) Read mapdata to get panel_ids and map_id -> panel_id mapping
data3 = open(r'C:\Users\lamou\AppData\Local\PNW Launcher\Game\Data\3.dat', 'rb').read()
ptr = struct.unpack_from('<I', data3, 0)[0]
r = MarshalReader(data3[ptr+2:])
idx = r.read()
offset = idx['mapdata.rxdata']
size = struct.unpack_from('<I', data3, offset)[0]
content = data3[offset+4:offset+4+size]
r2 = MarshalReader(content[2:])
mapdata = r2.read()

map_id_to_panel = {}
panel_to_maps = {}
for entry in mapdata[1]:
    if isinstance(entry, dict):
        d = entry
    elif hasattr(entry, '__dict__'):
        d = entry.__dict__
    else:
        continue
    panel_id = d.get('@panel_id', None)
    map_id = d.get('@map_id', None)
    entry_id = d.get('@id', None)
    if isinstance(map_id, int) and panel_id is not None:
        map_id_to_panel[map_id] = panel_id
    elif isinstance(map_id, list) and panel_id is not None:
        for mid in map_id:
            map_id_to_panel[mid] = panel_id
    if panel_id is not None:
        panel_to_maps.setdefault(panel_id, []).append(entry_id)

print("Panel IDs:", sorted(set(map_id_to_panel.values())))
print(f"Map 50 -> panel {map_id_to_panel.get(50, '?')}")
print()

# 2) Search 2.dat for a text table indexed by panel_id (text_get(10, panel_id))
# In PSDK, text tables are grouped in sets of 3 (EN, ES, FR).
# text_get(N, id) reads table index N*3+lang_id.
# For text_get(10, ...) with FR (lang=2), that's table index 10*3+2 = 32
# Let's find table #30, #31, #32 (EN, ES, FR for text_get(10))

data2 = open(r'C:\Users\lamou\AppData\Local\PNW Launcher\Game\Data\2.dat', 'rb').read()

i = 0
table_idx = 0
while i + 2 < len(data2):
    if data2[i] == 0x04 and data2[i+1] == 0x08:
        try:
            r = MarshalReader(data2[i+2:])
            val = r.read()
            if isinstance(val, list):
                if table_idx in [30, 31, 32, 33, 34, 35]:
                    print(f"Table #{table_idx} at offset {i} | {len(val)} entries:")
                    for j, v in enumerate(val[:15]):
                        print(f"  [{j}] {repr(v)[:100]}")
                    if len(val) > 15:
                        print(f"  ... ({len(val)} total)")
                    print()
                table_idx += 1
        except:
            pass
    i += 1

print(f"Total tables scanned: {table_idx}")

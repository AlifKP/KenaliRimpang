"""Ubah model TF.js hasil konversi Keras 3 ke format topologi/nama bobot ala Keras 2 yang bisa dibaca TF.js 4.x."""
import json, os, re, sys
from functools import reduce

src, out = sys.argv[1], sys.argv[2]
m = json.load(open(os.path.join(src, 'model.json')))

DROP = {'build_config', 'quantization_config', 'optional', 'synchronized', 'shared_object_id', 'module', 'registered_name'}

def fix_cfg(c):
    if isinstance(c, dict):
        if c.get('class_name') in ('DTypePolicy', 'FloatDTypePolicy'):
            return c['config']['name']
        d = {}
        for k, v in c.items():
            if k in DROP: continue
            if k == 'batch_shape': k = 'batch_input_shape'
            d[k] = fix_cfg(v)
        return d
    if isinstance(c, list):
        return [fix_cfg(x) for x in c]
    return c

def fix_nodes(nodes):
    res = []
    for n in nodes:
        a = n['args'][0]
        tens = a if isinstance(a, list) else [a]
        res.append([[t['config']['keras_history'][0], t['config']['keras_history'][1], t['config']['keras_history'][2], {}] for t in tens])
    return res

def fix_layer(l):
    nodes = l.get('inbound_nodes')
    l2 = {'class_name': l['class_name'], 'config': fix_cfg(l['config'])}
    if 'name' in l: l2['name'] = l['name']
    if l['class_name'] == 'Functional':
        l2['config']['layers'] = [fix_layer(x) for x in l['config']['layers']]
        for k in ('input_layers', 'output_layers'):
            v = l2['config'][k]
            if v and not isinstance(v[0], list): l2['config'][k] = [v]
    if nodes is not None:
        l2['inbound_nodes'] = fix_nodes(nodes)
    return l2

top = m['modelTopology']['model_config']
seq_layers = top['config']['layers']
assert top['class_name'] == 'Sequential' and seq_layers[0]['class_name'] == 'InputLayer'
inp = seq_layers[0]['config']['batch_shape']
new_seq = [fix_layer(l) for l in seq_layers[1:]]
new_seq[0]['config']['batch_input_shape'] = inp
top_new = {'class_name': 'Sequential', 'config': {'name': top['config']['name'], 'layers': new_seq}}

# --- nama bobot: path Keras 3 -> nama TF.js
VARS = {'Conv2D': ['kernel', 'bias'], 'DepthwiseConv2D': ['depthwise_kernel', 'bias'],
        'BatchNormalization': ['gamma', 'beta', 'moving_mean', 'moving_variance'], 'Dense': ['kernel', 'bias']}
def snake(n):
    n = re.sub(r'(.)([A-Z][a-z]+)', r'\1_\2', n)
    return re.sub(r'([a-z])([A-Z])', r'\1_\2', n).lower()
def path_map(layers, prefix, mp):
    used = {}
    for l in layers:
        s = snake(l['class_name'])
        if s in used: used[s] += 1; s = f'{s}_{used[s]}'
        else: used[s] = 0
        if l['class_name'] == 'Functional':
            path_map(l['config']['layers'], f'{prefix}{s}/layers/', mp)
        else:
            mp[f'{prefix}{s}'] = l
mp = {}
path_map(seq_layers[1:], 'layers/', mp)

specs = [w for g in m['weightsManifest'] for w in g['weights']]
buf = b''.join(open(os.path.join(src, p), 'rb').read() for g in m['weightsManifest'] for p in g['paths'])
off, keep = 0, []
for w in specs:
    n = reduce(lambda a, b: a * b, w['shape'], 1) * 4
    chunk = buf[off:off + n]; off += n
    mt = re.match(r'^(.*)/vars/(\d+)$', w['name'])
    if not mt or mt.group(1) not in mp: continue
    l = mp[mt.group(1)]
    c = l['config']
    vs = [v for v in VARS[l['class_name']] if not (v == 'bias' and not c.get('use_bias', True))]
    if l['class_name'] == 'BatchNormalization':
        vs = [v for v in vs if not (v == 'gamma' and not c.get('scale', True)) and not (v == 'beta' and not c.get('center', True))]
    keep.append(({'name': f"{c['name']}/{vs[int(mt.group(2))]}", 'shape': w['shape'], 'dtype': 'float32'}, chunk))
assert off == len(buf), (off, len(buf))
print('bobot dipakai:', len(keep), 'dari', len(specs))

os.makedirs(out, exist_ok=True)
data = b''.join(c for _, c in keep)
SH = 4 * 1024 * 1024
parts = [data[i:i + SH] for i in range(0, len(data), SH)]
paths = [f'group1-shard{i+1}of{len(parts)}.bin' for i in range(len(parts))]
for p, d in zip(paths, parts): open(os.path.join(out, p), 'wb').write(d)
m['modelTopology'] = {'keras_version': '2.15.0', 'backend': 'tensorflow', 'model_config': top_new}
m['weightsManifest'] = [{'paths': paths, 'weights': [s for s, _ in keep]}]
m['generatedBy'] = 'keras v2.15.0 (diubah dari Keras 3)'
json.dump(m, open(os.path.join(out, 'model.json'), 'w'))
print('selesai:', paths)

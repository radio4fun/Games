"""
Escada Vascular — adiciona um caso real (imagem + vídeo) à plataforma.

Requer: Python 3, opencv-python, numpy e o programa ffmpeg.

Uso (na pasta do site):
  python ferramentas/adicionar_caso.py \
      --entrada  "14-010 (21)#input.avi" \
      --deteccao "14-010 (21)#rfcn_resnet101_coco.avi" \
      --serie "14-010 (21)" --vaso "Coronária direita" \
      --modelo "R-FCN ResNet-101" --quadro-imagem 27

Se só existir o vídeo COM detecção e uma imagem limpa (sem caixas) de um quadro dele,
use --imagem no lugar de --entrada: o caso entra apenas no degrau 3 (imagem), e o script
descobre sozinho a qual quadro a imagem corresponde.
  python ferramentas/adicionar_caso.py --imagem "14_003_1_0005.bmp" \
      --deteccao "14-003 (1)#rfcn_resnet101_coco.avi" --serie "14-003 (1)" --vaso "Coronária direita"

O script:
  1. converte o vídeo SEM detecção para WebM e MP4 (assets/escada/);
  2. salva o quadro escolhido como imagem estática (.jpg);
  3. lê as caixas verdes do vídeo COM detecção, quadro a quadro, e rastreia a lesão principal;
  4. acrescenta (ou atualiza) o caso em assets/escada/casos.js, que a plataforma lê.
Os textos didáticos do caso (notas e dicas) podem ser editados depois em casos.js.
"""
import argparse, json, os, re, subprocess, sys
import cv2, numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('--entrada', help='vídeo sem detecção (#input.avi)')
ap.add_argument('--imagem', help='imagem sem caixas de um quadro do vídeo (quando não há o #input.avi)')
ap.add_argument('--deteccao', required=True, help='vídeo com as caixas da rede (#faster_rcnn..., #rfcn...)')
ap.add_argument('--serie', required=True); ap.add_argument('--vaso', default='')
ap.add_argument('--modelo', default='rede neural (Danilov et al., 2021)')
ap.add_argument('--quadro-imagem', type=int, default=None, help='quadro usado na etapa da imagem (padrão: o de melhor contraste com detecção)')
ap.add_argument('--fps', type=float, default=12.5)
ap.add_argument('--pasta', default='assets/escada')
ap.add_argument('--salto-max', type=float, default=50); ap.add_argument('--lacuna-max', type=int, default=10)
a = ap.parse_args()

def ler(p):
    cap = cv2.VideoCapture(p); fs = []
    while True:
        ok, f = cap.read()
        if not ok: break
        fs.append(f)
    if not fs: sys.exit(f'Não consegui ler {p}')
    return fs
if not a.entrada and not a.imagem: sys.exit('Informe --entrada (vídeo sem detecção) ou --imagem (imagem sem caixas).')
det = ler(a.deteccao)
ent = ler(a.entrada) if a.entrada else None
img_limpa = None
if not ent:
    img_limpa = cv2.imread(a.imagem)
    if img_limpa is None: sys.exit(f'Não consegui ler {a.imagem}')
    if img_limpa.shape[:2] != det[0].shape[:2]: img_limpa = cv2.resize(img_limpa, det[0].shape[1::-1])
    t = cv2.cvtColor(img_limpa, cv2.COLOR_BGR2GRAY).astype(np.float32); mg = 40
    notas = [(cv2.minMaxLoc(cv2.matchTemplate(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32), t[mg:-mg, mg:-mg], cv2.TM_CCOEFF_NORMED))[1:4:2], n) for n, f in enumerate(det)]
    (mx, loc), qimg = max(notas, key=lambda x: x[0][0])
    print(f'A imagem corresponde ao quadro {qimg} (correlação {mx:.3f}, deslocamento {loc[0]-mg},{loc[1]-mg} px).')
    if mx < 0.9 or abs(loc[0]-mg) > 3 or abs(loc[1]-mg) > 3:
        sys.exit('A imagem não coincide com nenhum quadro do vídeo; confira se é da mesma série.')
    if a.quadro_imagem is None: a.quadro_imagem = qimg
if ent and len(ent) != len(det): print(f'Aviso: {len(ent)} quadros sem detecção e {len(det)} com detecção.')
H, W = det[0].shape[:2]

def caixas(f):
    f = f.astype(int); m = ((f[..., 1] - f[..., 2] > 60) & (f[..., 1] - f[..., 0] > 20)).astype(np.uint8)
    k, _, st, _ = cv2.connectedComponentsWithStats(m, 8); out = []
    for i in range(1, k):
        x, y, w, h, area = st[i]
        if area < 40: continue
        sub = m[y:y + h, x:x + w]; cols = np.where(sub[-1])[0]
        if cols.size == 0: continue
        c0, c1 = cols.min(), cols.max(); r = h - 1
        while r >= 0 and sub[r, c0:c1 + 1].all(): r -= 1
        while r >= 0 and not sub[r, c0:c1 + 1].all(): r -= 1
        out.append((x + c0, y + max(r, 0), x + c1, y + h - 1))
    return out
Q = [caixas(f) for f in det]
com = [n for n, c in enumerate(Q) if c]
if not com: sys.exit('Nenhuma caixa verde encontrada no vídeo com detecção.')

def contraste(f):
    g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(float)
    return cv2.morphologyEx(g, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))[50:-50, 50:-50].mean()
qi = a.quadro_imagem if a.quadro_imagem is not None else max(com, key=lambda n: contraste(ent[n]))
if not Q[qi]: sys.exit(f'O quadro {qi} não tem detecção; escolha outro com --quadro-imagem ({com[0]}–{com[-1]} têm).')

centro = lambda b: ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
def rastrear(ordem, c):
    out = {}; ult = None
    for n in ordem:
        if ult is not None and abs(n - ult) > a.lacuna_max: break
        cand = [b for b in Q[n] if np.hypot(*np.subtract(centro(b), c)) < a.salto_max]
        if cand:
            b = min(cand, key=lambda b: np.hypot(*np.subtract(centro(b), c))); out[n] = b; c = centro(b); ult = n
    return out
c0 = centro(Q[qi][0]); trilha = {**rastrear(range(qi, -1, -1), c0), **rastrear(range(qi, len(Q)), c0)}
fs = sorted(trilha)
nb = lambda b: {'x': round(b[0] / W, 3), 'y': round(b[1] / H, 3), 'w': round((b[2] - b[0]) / W, 3), 'h': round((b[3] - b[1]) / H, 3)}
sem_det = [n for n in range(fs[0], fs[-1] + 1) if n not in trilha]
fora = sorted({n for n, cx in enumerate(Q) for b in cx if n not in trilha or b != trilha[n]})

slug = re.sub(r'[^0-9A-Za-z-]+', '_', a.serie).strip('_')
os.makedirs(a.pasta, exist_ok=True)
base = f'{a.pasta}/angio_{slug}'
if ent:
    for ext, args in (('webm', ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-row-mt', '1']),
                      ('mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-preset', 'slow', '-movflags', '+faststart'])):
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', a.entrada, *args, '-an', f'{base}.{ext}'], check=True)
cv2.imwrite(f'{base}_f{qi:03d}.jpg', ent[qi] if ent else img_limpa, [cv2.IMWRITE_JPEG_QUALITY, 92])

caso = {
    'id': slug, 'serie': a.serie, 'vaso': a.vaso, 'modeloIA': f'{a.modelo} (Danilov et al., 2021)',
    'imagem': f'{base}_f{qi:03d}.jpg', 'imagemQuadro': qi, 'imagemCaixa': nb(trilha[qi]),
    'notaImagem': '', 'dicaImagem': '',
}
if ent:  # o caso também entra no degrau 4 (vídeo)
    caso.update({
        'video': [f'{base}.webm', f'{base}.mp4'], 'fps': a.fps, 'totalQuadros': len(ent),
        'videoQuadrosChave': [{'f': f, **nb(trilha[f])} for f in fs],
        'videoJanela': [fs[0], fs[-1]],
        'deteccoesIA': {str(n): [list(nb(b).values()) for b in cx] for n, cx in enumerate(Q) if cx},
        'notaVideo': (
            f'Neste vídeo a rede detecta a lesão do quadro {fs[0]} ao {fs[-1]}'
            + (f', mas não a detecta em {len(sem_det)} quadro(s) ({", ".join(map(str, sem_det))}): falso negativo' if sem_det else '')
            + (f'; em {len(fora)} quadro(s) marca regiões fora da lesão principal (caixas amarelas): falso positivo.' if fora else '; não há marcações fora da lesão principal.')),
        'dicaVideo': '',
    })
arq = f'{a.pasta}/casos.js'
casos = []
if os.path.exists(arq):
    txt = open(arq, encoding='utf-8').read()
    casos = json.loads(txt[txt.index('['):txt.rindex(']') + 1])
antigo = next((c for c in casos if c['id'] == slug), None)
if antigo:  # preserva textos didáticos editados à mão
    for k in ('vaso', 'notaImagem', 'notaVideo', 'dicaImagem', 'dicaVideo'):
        if antigo.get(k) and not caso.get(k): caso[k] = antigo[k]
    casos = [caso if c['id'] == slug else c for c in casos]
else:
    casos.append(caso)
with open(arq, 'w', encoding='utf-8') as f:
    f.write('// Casos reais da Escada Vascular (gerado por ferramentas/adicionar_caso.py).\n'
            '// A ordem da lista é a ordem em que os casos aparecem nos degraus 3 e 4.\n'
            '// Textos editáveis: vaso, notaImagem, notaVideo, dicaImagem, dicaVideo.\n'
            'window.CASOS_ESCADA = ' + json.dumps(casos, ensure_ascii=False, indent=1) + ';\n')
print(f'Caso {a.serie} ({"imagem e vídeo" if ent else "só imagem, degrau 3"}): imagem = quadro {qi}; lesão nos quadros {fs[0]}–{fs[-1]} '
      f'({len(fs)} com detecção, {len(sem_det)} sem); {len(fora)} quadro(s) com caixas fora da lesão. Total de casos: {len(casos)}.')

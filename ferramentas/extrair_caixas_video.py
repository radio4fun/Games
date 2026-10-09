"""
Extrai as caixas verdes desenhadas pela rede (vídeos "...#faster_rcnn_..." do dataset
Danilov et al., 2021) e gera o trecho do CONFIG do EscadaVascular.html.

Uso:
    pip install opencv-python numpy
    python extrair_caixas_video.py "14-007 (3)#faster_rcnn_nas_lowproposals_coco.avi" --quadro-imagem 30

Saída (stdout): JSON com imagemCaixa, videoQuadrosChave, videoJanela e deteccoesIA.
A "lesão principal" é rastreada a partir da detecção mais próxima do quadro escolhido;
caixas longe dela entram só em deteccoesIA (exibidas como "outra detecção").
"""
import argparse, json
import cv2, numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('video'); ap.add_argument('--quadro-imagem', type=int, default=30)
ap.add_argument('--salto-max', type=float, default=50, help='px: maior deslocamento entre quadros da lesão rastreada')
ap.add_argument('--lacuna-max', type=int, default=10, help='quadros sem detecção tolerados dentro do rastreio')
a = ap.parse_args()

cap = cv2.VideoCapture(a.video); W = H = None; quadros = []
while True:
    ok, f = cap.read()
    if not ok: break
    H, W = f.shape[:2]; f = f.astype(int)
    m = ((f[..., 1] - f[..., 2] > 60) & (f[..., 1] - f[..., 0] > 20)).astype(np.uint8)  # verde
    k, _, st, _ = cv2.connectedComponentsWithStats(m, 8); caixas = []
    for i in range(1, k):
        x, y, w, h, area = st[i]
        if area < 40: continue
        sub = m[y:y + h, x:x + w]; cols = np.where(sub[-1])[0]
        if cols.size == 0: continue
        c0, c1 = cols.min(), cols.max(); r = h - 1
        while r >= 0 and sub[r, c0:c1 + 1].all(): r -= 1     # borda inferior
        while r >= 0 and not sub[r, c0:c1 + 1].all(): r -= 1  # interior até a borda superior
        caixas.append((x + c0, y + max(r, 0), x + c1, y + h - 1))
    quadros.append(caixas)

centro = lambda b: ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
ini = a.quadro_imagem
if not quadros[ini]: raise SystemExit(f'Sem detecção no quadro {ini}; escolha outro com --quadro-imagem')
def rastrear(ordem, c):
    out = {}; ult = None
    for n in ordem:
        if ult is not None and abs(n - ult) > a.lacuna_max: break
        cand = [b for b in quadros[n] if np.hypot(*np.subtract(centro(b), c)) < a.salto_max]
        if cand:
            b = min(cand, key=lambda b: np.hypot(*np.subtract(centro(b), c))); out[n] = b; c = centro(b); ult = n
    return out
c0 = centro(quadros[ini][0])
trilha = {**rastrear(range(ini, -1, -1), c0), **rastrear(range(ini, len(quadros)), c0)}
nb = lambda b: {'x': round(b[0] / W, 3), 'y': round(b[1] / H, 3), 'w': round((b[2] - b[0]) / W, 3), 'h': round((b[3] - b[1]) / H, 3)}
fs = sorted(trilha)
print(json.dumps({
    'referenciaConfirmada': True,
    'imagemQuadro': ini,
    'imagemCaixa': nb(trilha[ini]),
    'videoQuadrosChave': [{'f': f, **nb(trilha[f])} for f in fs],
    'videoJanela': [fs[0], fs[-1]],
    'deteccoesIA': {n: [list(nb(b).values()) for b in cx] for n, cx in enumerate(quadros) if cx},
}, indent=1))

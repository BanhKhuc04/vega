"""YOLOX (ONNX, onnxruntime CPU) on one frame: boxes as fractions [x, y, w, h], labels in Vietnamese (brief 0011, L3)."""
import cv2
import numpy as np

# COCO's 80 classes, in model order, with the Vietnamese label shown on the Vision screen
LABELS = [
    ('person', 'Người'), ('bicycle', 'Xe đạp'), ('car', 'Ô tô'), ('motorcycle', 'Xe máy'), ('airplane', 'Máy bay'),
    ('bus', 'Xe buýt'), ('train', 'Tàu hoả'), ('truck', 'Xe tải'), ('boat', 'Thuyền'), ('traffic light', 'Đèn giao thông'),
    ('fire hydrant', 'Trụ cứu hoả'), ('stop sign', 'Biển dừng'), ('parking meter', 'Đồng hồ đỗ xe'), ('bench', 'Ghế dài'),
    ('bird', 'Chim'), ('cat', 'Mèo'), ('dog', 'Chó'), ('horse', 'Ngựa'), ('sheep', 'Cừu'), ('cow', 'Bò'),
    ('elephant', 'Voi'), ('bear', 'Gấu'), ('zebra', 'Ngựa vằn'), ('giraffe', 'Hươu cao cổ'), ('backpack', 'Ba lô'),
    ('umbrella', 'Ô'), ('handbag', 'Túi xách'), ('tie', 'Cà vạt'), ('suitcase', 'Vali'), ('frisbee', 'Đĩa ném'),
    ('skis', 'Ván trượt tuyết'), ('snowboard', 'Ván trượt'), ('sports ball', 'Quả bóng'), ('kite', 'Diều'),
    ('baseball bat', 'Gậy bóng chày'), ('baseball glove', 'Găng bóng chày'), ('skateboard', 'Ván trượt'),
    ('surfboard', 'Ván lướt sóng'), ('tennis racket', 'Vợt tennis'), ('bottle', 'Chai'), ('wine glass', 'Ly rượu'),
    ('cup', 'Cốc'), ('fork', 'Dĩa'), ('knife', 'Dao'), ('spoon', 'Thìa'), ('bowl', 'Bát'), ('banana', 'Chuối'),
    ('apple', 'Táo'), ('sandwich', 'Bánh mì kẹp'), ('orange', 'Cam'), ('broccoli', 'Bông cải'), ('carrot', 'Cà rốt'),
    ('hot dog', 'Xúc xích'), ('pizza', 'Pizza'), ('donut', 'Bánh donut'), ('cake', 'Bánh ngọt'), ('chair', 'Ghế'),
    ('couch', 'Sofa'), ('potted plant', 'Chậu cây'), ('bed', 'Giường'), ('dining table', 'Bàn'), ('toilet', 'Bồn cầu'),
    ('tv', 'Màn hình'), ('laptop', 'Laptop'), ('mouse', 'Chuột'), ('remote', 'Điều khiển'), ('keyboard', 'Bàn phím'),
    ('cell phone', 'Điện thoại'), ('microwave', 'Lò vi sóng'), ('oven', 'Lò nướng'), ('toaster', 'Máy nướng bánh'),
    ('sink', 'Bồn rửa'), ('refrigerator', 'Tủ lạnh'), ('book', 'Sách'), ('clock', 'Đồng hồ'), ('vase', 'Lọ hoa'),
    ('scissors', 'Kéo'), ('teddy bear', 'Gấu bông'), ('hair drier', 'Máy sấy tóc'), ('toothbrush', 'Bàn chải'),
]
assert len(LABELS) == 80


class Detector:
    def __init__(self, model_path, conf=0.4, max_objects=20):
        import onnxruntime as ort  # imported here: CAMERA=sim and the tests run without it

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 2  # L10: two cores, the rest of VEGA keeps the others
        self.session = ort.InferenceSession(model_path, opts, providers=['CPUExecutionProvider'])
        inp = self.session.get_inputs()[0]
        self.input_name, self.size = inp.name, int(inp.shape[2])
        self.conf, self.max_objects = conf, max_objects
        self.grids, self.strides = _grids(self.size)

    def detect(self, bgr):
        """bgr: an OpenCV image. Returns [{'label', 'box': [x, y, w, h] fractions, 'conf'}], best first."""
        h, w = bgr.shape[:2]
        r = min(self.size / h, self.size / w)
        blob = np.full((self.size, self.size, 3), 114, np.uint8)
        blob[: int(h * r), : int(w * r)] = cv2.resize(bgr, (int(w * r), int(h * r)), interpolation=cv2.INTER_LINEAR)
        x = np.ascontiguousarray(blob.transpose(2, 0, 1)[None], dtype=np.float32)
        out = self.session.run(None, {self.input_name: x})[0][0]
        return decode(out, self.grids, self.strides, r, w, h, self.conf, self.max_objects)


def _grids(size):
    grids, strides = [], []
    for s in (8, 16, 32):
        n = size // s
        xv, yv = np.meshgrid(np.arange(n), np.arange(n))
        grids.append(np.stack((xv, yv), 2).reshape(-1, 2))
        strides.append(np.full((n * n, 1), s))
    return np.concatenate(grids), np.concatenate(strides)


def decode(out, grids, strides, r, w, h, conf, max_objects):
    """YOLOX raw output (N x 85: cx, cy, w, h, objectness, 80 class scores) -> objects in fractions of the frame."""
    xy = (out[:, :2] + grids) * strides / r
    wh = np.exp(np.minimum(out[:, 2:4], 10)) * strides / r
    scores = out[:, 4:5] * out[:, 5:]
    cls = scores.argmax(1)
    best = scores[np.arange(len(cls)), cls]
    keep = best >= conf
    if not keep.any():
        return []
    xy, wh, cls, best = xy[keep], wh[keep], cls[keep], best[keep]
    boxes = np.concatenate([xy - wh / 2, wh], 1)
    # class-aware NMS: shift each class far apart so boxes of different classes never suppress each other
    shifted = boxes.copy()
    shifted[:, :2] += cls[:, None] * 4096
    idx = cv2.dnn.NMSBoxes(shifted.tolist(), best.tolist(), conf, 0.45)
    objects = []
    for i in np.array(idx).flatten()[:max_objects]:
        x0, y0 = max(boxes[i, 0], 0), max(boxes[i, 1], 0)
        x1, y1 = min(boxes[i, 0] + boxes[i, 2], w), min(boxes[i, 1] + boxes[i, 3], h)
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        objects.append({
            'label': LABELS[cls[i]][1],
            'box': [round(x0 / w, 3), round(y0 / h, 3), round((x1 - x0) / w, 3), round((y1 - y0) / h, 3)],
            'conf': round(float(best[i]), 2),
        })
    return objects

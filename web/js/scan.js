/* 通用摄像头扫码（后台「新增商品」等处复用）
   用法：openScanDialog(code => { ... })
   纯粹离线：优先 BarcodeDetector，探测失败或运行报错自动降级到 ZXing；摄像头取不到时给出提示，不阻塞手动输入。 */
(function () {
    var MASK = 'scanMask';

    function zxingHints(Z) {
        var h = new Map();
        h.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
            Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A,
            Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39,
            Z.BarcodeFormat.CODE_93, Z.BarcodeFormat.ITF, Z.BarcodeFormat.QR_CODE
        ]);
        h.set(Z.DecodeHintType.TRY_HARDER, true);
        return h;
    }

    function build() {
        var old = document.getElementById(MASK);
        if (old) old.remove();
        var mask = document.createElement('div');
        mask.className = 'modal-mask show';
        mask.id = MASK;
        mask.style.zIndex = 70;
        mask.innerHTML =
            '<div class="modal" style="max-width:520px">' +
            '  <div class="modal-head"><h3>扫码</h3><button class="modal-close" data-scan-close>×</button></div>' +
            '  <div class="modal-body">' +
            '    <div style="position:relative;height:230px;background:#0B1220;border-radius:12px;overflow:hidden">' +
            '      <video id="scanVideo" playsinline muted autoplay style="width:100%;height:100%;object-fit:cover"></video>' +
            '    </div>' +
            '    <div id="scanTip" class="hint" style="margin-top:8px;color:var(--muted);font-size:12px">把条码放进框里</div>' +
            '    <input class="input" id="scanManual" placeholder="手动输入条码，回车确认" enterkeyhint="done" style="margin-top:8px">' +
            '    <input type="file" id="scanFile" accept="image/*" capture="environment" style="display:none">' +
            '  </div>' +
            '  <div class="modal-foot">' +
            '    <button class="btn ghost" id="scanAlbum">相册识别</button>' +
            '    <button class="btn ghost" data-scan-close>关闭</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(mask);
        return mask;
    }

    function openScanDialog(onCode) {
        var mask = build();
        var video = mask.querySelector('#scanVideo');
        var tip = mask.querySelector('#scanTip');
        var manual = mask.querySelector('#scanManual');
        var stream = null, timer = null, loopOn = true, reader = null, running = false;

        function close() {
            loopOn = false;
            if (timer) { clearTimeout(timer); timer = null; }
            if (reader) { try { reader.reset(); } catch (e) { } reader = null; }
            if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
            video.srcObject = null;
            if (timer) clearTimeout(timer);
            mask.remove();
        }

        function done(code) {
            code = String(code || '').trim();
            if (!code) return;
            close();
            onCode(code);
        }

        mask.addEventListener('click', function (e) {
            if (e.target.hasAttribute('data-scan-close') || e.target.closest('[data-scan-close]')) close();
        });
        manual.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') done(manual.value);
        });
        mask.querySelector('#scanAlbum').addEventListener('click', function () {
            mask.querySelector('#scanFile').click();
        });
        mask.querySelector('#scanFile').addEventListener('change', function (e) {
            var f = e.target.files && e.target.files[0];
            e.target.value = '';
            if (!f) return;
            tip.textContent = '正在识别图片…';
            decodeImage(f).then(function (code) {
                if (code) done(code);
                else tip.textContent = '没识别到条码，重拍一张再试';
            }, function () { tip.textContent = '图片识别出错'; });
        });

        function imgToCanvas(img) {
            var c = document.createElement('canvas');
            c.width = img.naturalWidth || img.width;
            c.height = img.naturalHeight || img.height;
            c.getContext('2d').drawImage(img, 0, 0);
            return c;
        }

        function decodeCanvas(c) {
            var Z = window.ZXing;
            if (!Z) return '';
            var hints = zxingHints(Z);
            var readers = [];
            var sizes = [];
            var maxSide = Math.max(c.width, c.height);
            if (maxSide > 900) sizes.push(900); else sizes.push(maxSide);
            for (var i = 0; i < sizes.length; i++) {
                var s = sizes[i] / maxSide;
                var cv = c;
                if (s < 1) {
                    cv = document.createElement('canvas');
                    cv.width = Math.round(c.width * s);
                    cv.height = Math.round(c.height * s);
                    cv.getContext('2d').drawImage(c, 0, 0, cv.width, cv.height);
                }
                try {
                    var r = new Z.MultiFormatReader();
                    r.setHints(hints);
                    var res = r.decode(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(cv)), hints);
                    if (res) return res.getText();
                } catch (e) { }
                // 竖图兜底
                try {
                    var rc = document.createElement('canvas');
                    rc.width = cv.height; rc.height = cv.width;
                    var x = rc.getContext('2d');
                    x.translate(rc.width / 2, rc.height / 2);
                    x.rotate(Math.PI / 2);
                    x.drawImage(cv, -cv.width / 2, -cv.height / 2);
                    var r2 = new Z.MultiFormatReader();
                    r2.setHints(hints);
                    var res2 = r2.decode(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(rc)), hints);
                    if (res2) return res2.getText();
                } catch (e) { }
            }
            return '';
        }

        function decodeImage(file) {
            return new Promise(function (resolve, reject) {
                var img = new Image();
                img.onload = function () { resolve(decodeCanvas(imgToCanvas(img))); };
                img.onerror = reject;
                img.src = URL.createObjectURL(file);
            });
        }

        function startZXing() {
            var Z = window.ZXing;
            if (!Z) { tip.textContent = '识别组件未加载，请手动输入条码'; return; }
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d', { willReadFrequently: true });
            var hints = zxingHints(Z);
            reader = new Z.MultiFormatReader();
            reader.setHints(hints);
            var ticks = 0;

            var grab = function (sx, sy, sw, sh) {
                if (sw < 30 || sh < 30) return '';
                var scale = Math.min(1, 800 / sw);
                canvas.width = Math.round(sw * scale);
                canvas.height = Math.round(sh * scale);
                ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
                try {
                    var res = reader.decode(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)), hints);
                    return res ? res.getText() : '';
                } catch (e) { return ''; }
                finally { try { reader.reset(); } catch (e) { } }
            };

            var loop = function () {
                if (!loopOn || !stream) return;
                var vw = video.videoWidth, vh = video.videoHeight;
                if (vw && vh) {
                    var code = grab(vw * 0.1, Math.max(0, (vh - vh * 0.34) / 2), vw * 0.8, vh * 0.34);
                    if (!code) code = grab(0, 0, vw, vh);
                    if (code) { running = false; done(code); return; }
                    if (++ticks % 5 === 0) tip.textContent = '正在识别… 已取 ' + ticks + ' 帧';
                }
                timer = setTimeout(loop, 220);
            };
            running = true;
            loop();
        }

        async function startCamera() {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                tip.textContent = '此浏览器不支持摄像头，请手动输入条码';
                return;
            }
            if (!(window.isSecureContext)) {
                tip.textContent = 'http 地址不能调摄像头，手机请用 https 访问';
                return;
            }
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
                    audio: false
                });
                video.srcObject = stream;
                await video.play();
            } catch (e) {
                tip.textContent = '无法打开摄像头：' + (e.message || '权限被拒绝');
                return;
            }

            if ('BarcodeDetector' in window) {
                var det = null;
                try {
                    det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'qr_code'] });
                } catch (e0) { det = null; }
                if (det) {
                    try { await det.detect(video); }
                    catch (e1) { det = null; }
                }
                if (det) {
                    var bd = async function () {
                        if (!loopOn || !stream) return;
                        try {
                            var codes = await det.detect(video);
                            if (codes && codes.length) { done(codes[0].rawValue); return; }
                        } catch (e2) { startZXing(); return; }
                        timer = setTimeout(bd, 320);
                    };
                    bd();
                    return;
                }
            }
            startZXing();
        }

        // 先能拿到帧再开工，避免视频还没就绪
        video.addEventListener('loadeddata', function () { /* noop */ });
        startCamera();
    }

    window.openScanDialog = openScanDialog;
})();

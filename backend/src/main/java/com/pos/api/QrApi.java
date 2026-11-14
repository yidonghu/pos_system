package com.pos.api;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.client.j2se.MatrixToImageWriter;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.ByteArrayOutputStream;
import java.util.Map;

/** 二维码：把收银端地址变成图，安卓扫一下直接进，不用记 IP 和端口 */
@RestController
@RequestMapping("/api")
public class QrApi {

    @GetMapping("/qr.png")
    public ResponseEntity<byte[]> qr(@RequestParam(value = "text", required = false) String text,
                                     @RequestParam(value = "size", required = false, defaultValue = "300") int size) throws Exception {
        String content = (text == null || text.isBlank()) ? com.pos.util.Net.lanUrl() + "/pos" : text;
        if (content.length() > 300) content = content.substring(0, 300);
        int px = Math.min(Math.max(size, 120), 800);

        QRCodeWriter writer = new QRCodeWriter();
        BitMatrix matrix = writer.encode(content, BarcodeFormat.QR_CODE, px, px,
                Map.of(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M,
                        EncodeHintType.MARGIN, 1,
                        EncodeHintType.CHARACTER_SET, "UTF-8"));

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        MatrixToImageWriter.writeToStream(matrix, "PNG", out);
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_PNG)
                .cacheControl(CacheControl.noStore())
                .body(out.toByteArray());
    }
}

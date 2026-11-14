package com.pos.web;

import com.pos.util.Net;
import org.apache.catalina.connector.Connector;
import org.apache.tomcat.util.net.SSLHostConfig;
import org.apache.tomcat.util.net.SSLHostConfigCertificate;
import org.bouncycastle.asn1.x500.X500Name;
import org.bouncycastle.asn1.x509.BasicConstraints;
import org.bouncycastle.asn1.x509.Extension;
import org.bouncycastle.asn1.x509.GeneralName;
import org.bouncycastle.asn1.x509.GeneralNames;
import org.bouncycastle.cert.X509CertificateHolder;
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter;
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder;
import org.bouncycastle.operator.ContentSigner;
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigInteger;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/**
 * 局域网 HTTPS：安卓只允许在安全上下文（https / localhost）里调用摄像头，
 * 所以除 8080 的 HTTP 外再开 8443 的 HTTPS。
 * 证书为本机自签、十年有效、自动把当前局域网 IP 写进 SAN，IP 变了会自动重签。
 */
@Configuration
public class TlsConfig {

    private static final String PASS = "pos-local";
    private static final String ALIAS = "pos";
    private static final Path STORE = Paths.get("data", "tls.p12");
    private static final int HTTPS_PORT = 8443;

    @Bean
    public WebServerFactoryCustomizer<TomcatServletWebServerFactory> httpsCustomizer() {
        return factory -> {
            try {
                ensureStore();
                Connector c = new Connector(TomcatServletWebServerFactory.DEFAULT_PROTOCOL);
                c.setPort(HTTPS_PORT);
                c.setSecure(true);
                c.setScheme("https");
                c.setProperty("SSLEnabled", "true");

                SSLHostConfig ssl = new SSLHostConfig();
                ssl.setHostName("_default_");
                ssl.setProtocols("TLSv1.2,TLSv1.3");
                SSLHostConfigCertificate cert = new SSLHostConfigCertificate(ssl, SSLHostConfigCertificate.DEFAULT_TYPE);
                cert.setCertificateKeystoreFile(STORE.toAbsolutePath().toString());
                cert.setCertificateKeystorePassword(PASS);
                cert.setCertificateKeystoreType("PKCS12");
                ssl.addCertificate(cert);
                c.addSslHostConfig(ssl);

                factory.addAdditionalTomcatConnectors(c);
            } catch (Exception e) {
                System.out.println("[POS] HTTPS(8443) 启动失败：" + e.getMessage() + "（http 8080 仍可用）");
            }
        };
    }

    private static synchronized void ensureStore() throws Exception {
        List<String> ips = Net.lanIps();
        if (Files.exists(STORE)) {
            try {
                KeyStore ks = KeyStore.getInstance("PKCS12");
                try (InputStream in = Files.newInputStream(STORE)) {
                    ks.load(in, PASS.toCharArray());
                }
                X509Certificate cert = (X509Certificate) ks.getCertificate(ALIAS);
                if (cert != null && cert.getNotAfter().after(new Date()) && coversAll(cert, ips)) {
                    return;
                }
            } catch (Exception ignored) {
                // 证书损坏或过期，重签
            }
        }
        generate(ips);
        System.out.println("[POS] 已生成自签证书 data/tls.p12，手机访问 " + Net.lanSecureUrl() + "/pos");
    }

    private static boolean coversAll(X509Certificate cert, List<String> ips) {
        boolean localhost = false;
        List<String> certIps = new ArrayList<>();
        try {
            List<List<?>> sans = cert.getSubjectAlternativeNames() == null
                    ? new ArrayList<>() : new ArrayList<>(cert.getSubjectAlternativeNames());
            for (List<?> san : sans) {
                int type = (Integer) san.get(0);
                Object value = san.get(1);
                if (type == 2 && "localhost".equalsIgnoreCase(String.valueOf(value))) localhost = true;
                if (type == 7) certIps.add(String.valueOf(value));
            }
        } catch (Exception e) {
            return false;
        }
        return localhost && certIps.containsAll(ips) && certIps.contains("127.0.0.1");
    }

    private static void generate(List<String> ips) throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048);
        KeyPair kp = kpg.generateKeyPair();

        X500Name subject = new X500Name("CN=POS Local, O=POS Shop, C=CN");
        Date from = new Date(System.currentTimeMillis() - 24L * 3600 * 1000);
        Date to = new Date(System.currentTimeMillis() + 3650L * 24 * 3600 * 1000);
        JcaX509v3CertificateBuilder builder = new JcaX509v3CertificateBuilder(
                subject, BigInteger.valueOf(System.currentTimeMillis()), from, to, subject, kp.getPublic());

        List<GeneralName> names = new ArrayList<>();
        names.add(new GeneralName(GeneralName.dNSName, "localhost"));
        names.add(new GeneralName(GeneralName.dNSName, "pos.home.arpa"));
        names.add(new GeneralName(GeneralName.iPAddress, "127.0.0.1"));
        for (String ip : ips) {
            if (!"127.0.0.1".equals(ip)) names.add(new GeneralName(GeneralName.iPAddress, ip));
        }
        builder.addExtension(Extension.subjectAlternativeName, false,
                new GeneralNames(names.toArray(new GeneralName[0])));
        builder.addExtension(Extension.basicConstraints, true, new BasicConstraints(false));

        ContentSigner signer = new JcaContentSignerBuilder("SHA256withRSA").build(kp.getPrivate());
        X509Certificate cert = new JcaX509CertificateConverter()
                .getCertificate(builder.build(signer));
        cert.verify(kp.getPublic());

        Files.createDirectories(STORE.getParent());
        KeyStore ks = KeyStore.getInstance("PKCS12");
        ks.load(null, null);
        ks.setKeyEntry(ALIAS, kp.getPrivate(), PASS.toCharArray(), new Certificate[]{cert});
        try (OutputStream out = Files.newOutputStream(STORE)) {
            ks.store(out, PASS.toCharArray());
        }
    }
}

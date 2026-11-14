package com.pos;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

@SpringBootApplication
public class PosApplication {

    public static void main(String[] args) throws Exception {
        Files.createDirectories(Path.of("data"));
        Files.createDirectories(Path.of("backup"));
        applyPendingRestore();

        SpringApplication.run(PosApplication.class, args);

        System.out.println("==========================================================");
        System.out.println(" POS 已启动");
        System.out.println(" 收银台: http://localhost:8080/pos");
        System.out.println(" 管理后台: http://localhost:8080/admin  (默认密码 admin888)");
        System.out.println("==========================================================");
    }

    /** 如果后台恢复上传了备份，启动时替换数据库 */
    private static void applyPendingRestore() throws Exception {
        Path pending = Path.of("data/pos.db.pending");
        if (!Files.exists(pending)) return;

        Path db = Path.of("data/pos.db");
        if (Files.exists(db)) {
            String backupName = "data/pos.db.bak-" + System.currentTimeMillis();
            Files.copy(db, Path.of(backupName), StandardCopyOption.REPLACE_EXISTING);
        }
        Files.deleteIfExists(Path.of("data/pos.db-wal"));
        Files.deleteIfExists(Path.of("data/pos.db-shm"));
        Files.move(pending, db, StandardCopyOption.REPLACE_EXISTING);
        System.out.println("[POS] 已应用备份恢复: " + db.toAbsolutePath());
    }
}

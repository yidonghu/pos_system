package com.pos.util;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** 本机网络工具：取局域网地址，供手机/自助机扫码打开收银端 */
public final class Net {

    private Net() {
    }

    /** 本机所有局域网 IPv4 地址（按网卡顺序） */
    public static List<String> lanIps() {
        List<String> ips = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback() || ni.isVirtual()) continue;
                for (InterfaceAddress addr : ni.getInterfaceAddresses()) {
                    InetAddress a = addr.getAddress();
                    if (a instanceof Inet4Address && a.isSiteLocalAddress() && !ips.contains(a.getHostAddress())) {
                        ips.add(a.getHostAddress());
                    }
                }
            }
        } catch (Exception e) {
            // 忽略，走下面的兜底
        }
        if (ips.isEmpty()) {
            try {
                ips.add(InetAddress.getLocalHost().getHostAddress());
            } catch (Exception e) {
                ips.add("127.0.0.1");
            }
        }
        return ips;
    }

    /** 收银端局域网地址（HTTP，只能手输/扫码枪） */
    public static String lanUrl() {
        return "http://" + lanIps().get(0) + ":8080";
    }

    /** 收银端局域网地址（HTTPS，可调用摄像头扫码） */
    public static String lanSecureUrl() {
        return "https://" + lanIps().get(0) + ":8443";
    }
}

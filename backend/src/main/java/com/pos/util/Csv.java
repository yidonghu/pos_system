package com.pos.util;

import java.util.ArrayList;
import java.util.List;

public class Csv {

    public static String escape(String v) {
        if (v == null) return "";
        String s = v.replace("\r", " ").replace("\n", " ");
        if (s.contains(",") || s.contains("\"") || s.contains(";")) {
            return "\"" + s.replace("\"", "\"\"") + "\"";
        }
        return s;
    }

    public static String build(List<String> headers, List<List<String>> rows) {
        StringBuilder sb = new StringBuilder();
        sb.append("\uFEFF");
        sb.append(String.join(",", headers.stream().map(Csv::escape).toList())).append("\r\n");
        for (List<String> row : rows) {
            sb.append(String.join(",", row.stream().map(Csv::escape).toList())).append("\r\n");
        }
        return sb.toString();
    }

    public static List<List<String>> parse(String text) {
        List<List<String>> rows = new ArrayList<>();
        if (text == null) return rows;
        if (text.startsWith("\uFEFF")) text = text.substring(1);

        List<String> row = new ArrayList<>();
        StringBuilder cell = new StringBuilder();
        boolean quoted = false;

        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (quoted) {
                if (c == '"') {
                    if (i + 1 < text.length() && text.charAt(i + 1) == '"') {
                        cell.append('"');
                        i++;
                    } else {
                        quoted = false;
                    }
                } else {
                    cell.append(c);
                }
            } else {
                switch (c) {
                    case '"' -> quoted = true;
                    case ',' -> {
                        row.add(cell.toString().trim());
                        cell.setLength(0);
                    }
                    case '\r' -> {
                    }
                    case '\n' -> {
                        row.add(cell.toString().trim());
                        cell.setLength(0);
                        if (!row.isEmpty() && !(row.size() == 1 && row.get(0).isEmpty())) {
                            rows.add(row);
                        }
                        row = new ArrayList<>();
                    }
                    default -> cell.append(c);
                }
            }
        }
        row.add(cell.toString().trim());
        if (!row.isEmpty() && !(row.size() == 1 && row.get(0).isEmpty())) {
            rows.add(row);
        }
        return rows;
    }
}

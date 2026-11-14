package com.pos.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class PageController {

    @GetMapping("/")
    public String root() {
        return "redirect:/index.html";
    }

    @GetMapping({"/pos", "/pos/"})
    public String pos() {
        return "forward:/pos/index.html";
    }

    @GetMapping({"/admin", "/admin/"})
    public String admin() {
        return "forward:/admin/index.html";
    }
}

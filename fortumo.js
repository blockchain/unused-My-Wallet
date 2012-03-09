var XD = function () {
        var e, d, b = 1,
            c, a = this;
        return {
            receiveMessage: function (g, f) {
                if (a.postMessage) {
                    if (g) {
                        c = function (h) {
                            if ((typeof f === "string" && h.origin !== f) || (Object.prototype.toString.call(f) === "[object Function]" && f(h.origin) === !1)) {
                                return !1
                            }
                            g(h)
                        }
                    }
                    if (a.addEventListener) {
                        a[g ? "addEventListener" : "removeEventListener"]("message", c, !1)
                    } else {
                        a[g ? "attachEvent" : "detachEvent"]("onmessage", c)
                    }
                } else {
                    e && clearInterval(e);
                    e = null;
                    if (g) {
                        e = setInterval(function () {
                            var i = document.location.hash,
                                h = /^#?\d+&/;
                            if (i !== d && h.test(i)) {
                                d = i;
                                g({
                                    data: i.replace(h, "")
                                })
                            }
                        }, 100)
                    }
                }
            },
            setCookie: function (h) {
                var g = new Date();
                var i = new Date(g.getTime() + 60 * 60 * 24 * 30 * 6);
                var f = i.toGMTString();
                document.cookie = "fmp_pid=" + escape(h) + ";expires=" + f;
                return
            },
            readCookies: function () {
                var h = document.cookie.split(";");
                var g = {};
                for (var f = 0; f < h.length; f++) {
                    var j = h[f].split("=");
                    g[j[0]] = unescape(j[1])
                }
                return g
            },
            customize: function () {
                var g = XD.readCookies();
                var f = 0;
                $fmpJQ.each(g, function (h, i) {
                    if ($fmpJQ.trim(h) == "fmp_pid") {
                        f = $fmpJQ.trim(i)
                    }
                });
                $fmpJQ.ajax({
                    type: "get",
                    dataType: "jsonp",
                    data: "customer=" + f,
                    url: "http://fortumo.com/mobile_payments/customize",
                    success: function (h) {
                        if (h.image) {
                            $fmpJQ("a#fmp-button img").attr("src", h.image)
                        }
                        if (h.country) {
                            $fmpJQ("a#fmp-button").append(h.country)
                        }
                    }
                })
            }
        }
    }();
var $fmpJQ = jQuery.noConflict();
(function (t, P) {
    var D = {
        transition: "elastic",
        speed: 300,
        width: false,
        initialWidth: "600",
        innerWidth: false,
        maxWidth: false,
        height: false,
        initialHeight: "450",
        innerHeight: false,
        maxHeight: false,
        scalePhotos: true,
        scrolling: true,
        inline: false,
        html: false,
        iframe: false,
        photo: false,
        href: false,
        title: false,
        rel: false,
        opacity: 0.9,
        preloading: true,
        current: "image {current} of {total}",
        previous: "previous",
        next: "next",
        close: "close",
        open: false,
        returnFocus: true,
        loop: true,
        slideshow: false,
        slideshowAuto: true,
        slideshowSpeed: 2500,
        slideshowStart: "start slideshow",
        slideshowStop: "stop slideshow",
        onOpen: false,
        onLoad: false,
        onComplete: false,
        onCleanup: false,
        onClosed: false,
        overlayClose: true,
        escKey: true,
        arrowKey: true
    },
        r = "fmpWidget",
        M = "fmpbox",
        O = M + "_open",
        c = M + "_load",
        N = M + "_complete",
        k = M + "_cleanup",
        V = M + "_closed",
        f = M + "_purge",
        J = M + "_loaded",
        l = t.browser.msie && !t.support.opacity,
        aa = l && t.browser.version < 7,
        U = M + "_IE6",
        Q, z, y, h, u, K, X, E, g, b, T, x, B, L, o, G, R, p, W, ab, i, e, a, m, C, Y, w, S, H = false,
        F, j = M + "Element";

    function n(ad, ac) {
        ad = ad ? ' id="' + M + ad + '"' : "";
        ac = ac ? ' style="' + ac + '"' : "";
        return t("<div" + ad + ac + "/>")
    }
    function I(ac, ad) {
        ad = ad === "x" ? b.width() : b.height();
        return (typeof ac === "string") ? Math.round((/%/.test(ac) ? (ad / 100) * parseInt(ac, 10) : parseInt(ac, 10))) : ac
    }
    function v(ac) {
        return false
    }
    function Z(ad) {
        for (var ac in ad) {
            if (t.isFunction(ad[ac]) && ac.substring(0, 2) !== "on") {
                ad[ac] = ad[ac].call(m)
            }
        }
        ad.rel = ad.rel || m.rel || "nofollow";
        ad.href = q(m);
        ad.title = ad.title || m.title;
        return ad
    }
    function q(ac) {
        href = t(ac).attr("rel") || href;
        if (!href.match(/^http:/) && !t.browser.mobile && !Fortumo.isTablet()) {
            href = "http://fortumo.com/mobile_payments/" + href.replace(/^\//, "")
        } else {
            if (!href.match(/^http:/) && (t.browser.mobile || Fortumo.isTablet())) {
                href = "http://fortumo.com/mobile_widget?service_id=" + href.replace("/", "&cuid=").replace(/^\//, "").replace(/\?/, "&")
            }
        }
        href += (href.match(/\?/) ? "&" : "?") + "fcb=" + encodeURIComponent(document.location.href);
        if (t(ac).attr("data-cuid")) {
            href += ("&cuid=" + t(ac).attr("data-cuid"))
        }
        if (t(ac).attr("data-country-id")) {
            href += ("&country_id=" + t(ac).attr("data-country-id"))
        }
        if (t(ac).attr("data-tc-id")) {
            href += ("&tc_id=" + t(ac).attr("data-tc-id"))
        }
        if (t(ac).attr("data-currency")) {
            href += ("&currency=" + t(ac).attr("data-currency"))
        }
        if (t(ac).attr("data-amount")) {
            href += ("&amount=" + t(ac).attr("data-amount"))
        }
        if (t(ac).attr("data-price")) {
            href += ("&price=" + t(ac).attr("data-price"))
        }
        if (t(ac).attr("data-credit-name")) {
            href += ("&credit_name=" + t(ac).attr("data-credit-name"))
        }
        if (t(ac).attr("data-surcharge")) {
            href += ("&surcharge=" + t(ac).attr("data-surcharge"))
        }
        if (t(ac).attr("data-display-type")) {
            href += ("&display_type=" + t(ac).attr("data-display-type"))
        }
        if (t(ac).attr("data-sig")) {
            href += ("&sig=" + t(ac).attr("data-sig"))
        }
        return href
    }
    function A(ac, ad) {
        if (ad) {
            ad.call(m)
        }
        t.event.trigger(ac)
    }
    function s() {}
    function d(ac) {
        if (!H) {
            m = ac;
            Y = Z(t.extend({}, t.data(m, r)));
            g = t(m);
            C = 0;
            if (Y.rel !== "nofollow") {
                g = t("." + j).filter(function () {
                    var ae = t.data(this, r).rel || this.rel;
                    return (ae === Y.rel)
                });
                C = g.index(m);
                if (C === -1) {
                    g = g.add(m);
                    C = g.length - 1
                }
            }
            if (!w) {
                w = S = true;
                z.show();
                if (Y.returnFocus) {
                    try {
                        m.blur();
                        t(m).one(V, function () {
                            try {
                                this.focus()
                            } catch (ae) {}
                        })
                    } catch (ad) {}
                }
                Q.css({
                    opacity: +Y.opacity,
                    cursor: Y.overlayClose ? "pointer" : "auto"
                }).show();
                Y.w = I(Y.initialWidth, "x");
                Y.h = I(Y.initialHeight, "y");
                F.position(0);
                if (aa) {
                    b.bind("resize." + U + " scroll." + U, function () {
                        Q.css({
                            width: b.width(),
                            height: b.height(),
                            top: b.scrollTop(),
                            left: b.scrollLeft()
                        })
                    }).trigger("scroll." + U)
                }
                A(O, Y.onOpen);
                o.add(p).add(R).add(G).add(L).hide();
                W.html(Y.close).show()
            }
            F.load(true)
        }
    }
    F = t.fn[r] = t[r] = function (ad, af) {
        var ac = this,
            ae;
        if (!ac[0] && ac.selector) {
            return ac
        }
        ad = ad || {};
        if (af) {
            ad.onComplete = af
        }
        if (!ac[0] || ac.selector === undefined) {
            ac = t("<a/>");
            ad.open = true
        }
        ac.each(function () {
            t.data(this, r, t.extend({}, t.data(this, r) || D, ad));
            t(this).addClass(j)
        });
        ae = ad.open;
        if (t.isFunction(ae)) {
            ae = ae.call(ac)
        }
        if (ae) {
            d(ac[0])
        }
        return ac
    };
    F.init = function () {
        b = t(P);
        z = n().attr({
            id: r,
            "class": l ? M + "IE" : ""
        });
        Q = n("Overlay", aa ? "position:absolute" : "").hide();
        y = n("Wrapper");
        h = n("Content").append(T = n("LoadedContent", "width:0; height:0; overflow:hidden"), B = n("LoadingOverlay").add(n("LoadingGraphic")), L = n("Title"), o = n("Current"), R = n("Next"), p = n("Previous"), G = n("Slideshow").bind(O, s), W = n("Close"));
        y.append(n().append(n("TopLeft"), u = n("TopCenter"), n("TopRight")), n(false, "clear:left").append(K = n("MiddleLeft"), h, X = n("MiddleRight")), n(false, "clear:left").append(n("BottomLeft"), E = n("BottomCenter"), n("BottomRight"))).children().children().css({
            "float": "left"
        });
        x = n(false, "position:absolute; width:9999px; visibility:hidden; display:none");
        t("body").prepend(Q, z.append(y, x));
        h.children().hover(function () {
            t(this).addClass("hover")
        }, function () {
            t(this).removeClass("hover")
        }).addClass("hover");
        ab = u.height() + E.height() + h.outerHeight(true) - h.height();
        i = K.width() + X.width() + h.outerWidth(true) - h.width();
        e = T.outerHeight(true);
        a = T.outerWidth(true);
        z.css({
            "padding-bottom": ab,
            "padding-right": i
        }).hide();
        R.click(F.next);
        p.click(F.prev);
        W.click(F.close);
        h.children().removeClass("hover");
        t("." + j).live("click", function (ac) {
            if (t.browser.mobile || Fortumo.isTablet()) {
                elem = t(this);
                elem.attr({
                    href: q(elem),
                    target: "_blank"
                });
                return true
            } else {
                if (!((ac.button !== 0 && typeof ac.button !== "undefined") || ac.ctrlKey || ac.shiftKey || ac.altKey)) {
                    ac.preventDefault();
                    d(this)
                }
            }
        });
        Q.click(function () {
            if (Y.overlayClose) {
                F.close()
            }
        });
        t(document).bind("keydown", function (ac) {
            if (w && Y.escKey && ac.keyCode === 27) {
                ac.preventDefault();
                F.close()
            }
            if (w && Y.arrowKey && !S && g[1]) {
                if (ac.keyCode === 37 && (C || Y.loop)) {
                    ac.preventDefault();
                    p.click()
                } else {
                    if (ac.keyCode === 39 && (C < g.length - 1 || Y.loop)) {
                        ac.preventDefault();
                        R.click()
                    }
                }
            }
        })
    };
    F.remove = function () {
        z.add(Q).remove();
        t("." + j).die("click").removeData(r).removeClass(j)
    };
    F.position = function (ag, ad) {
        var af, ae = Math.max(document.documentElement.clientHeight - Y.h - e - ab, 0) / 2 + b.scrollTop(),
            ac = Math.max(b.width() - Y.w - a - i, 0) / 2 + b.scrollLeft();
        af = (z.width() === Y.w + a && z.height() === Y.h + e) ? 0 : ag;
        y[0].style.width = y[0].style.height = "9999px";

        function ah(ai) {
            u[0].style.width = E[0].style.width = h[0].style.width = ai.style.width;
            B[0].style.height = B[1].style.height = h[0].style.height = K[0].style.height = X[0].style.height = ai.style.height
        }
        z.dequeue().animate({
            width: Y.w + a,
            height: Y.h + e,
            top: ae,
            left: ac
        }, {
            duration: af,
            complete: function () {
                ah(this);
                S = false;
                y[0].style.width = (Y.w + a + i) + "px";
                y[0].style.height = (Y.h + e + ab) + "px";
                if (ad) {
                    ad()
                }
            },
            step: function () {
                ah(this)
            }
        })
    };
    F.resize = function (ac) {
        if (w) {
            ac = ac || {};
            if (ac.width) {
                Y.w = I(ac.width, "x") - a - i
            }
            if (ac.innerWidth) {
                Y.w = I(ac.innerWidth, "x")
            }
            T.css({
                width: Y.w
            });
            if (ac.height) {
                Y.h = I(ac.height, "y") - e - ab
            }
            if (ac.innerHeight) {
                Y.h = I(ac.innerHeight, "y")
            }
            if (!ac.innerHeight && !ac.height) {
                var ad = T.wrapInner("<div style='overflow:auto'></div>").children();
                Y.h = ad.height();
                ad.replaceWith(ad.children())
            }
            T.css({
                height: Y.h
            });
            F.position(Y.transition === "none" ? 0 : Y.speed)
        }
    };
    F.prep = function (af) {
        if (!w) {
            return
        }
        var ae, ag = Y.transition === "none" ? 0 : Y.speed;
        b.unbind("resize." + M);
        T.remove();
        T = n("LoadedContent").html(af);

        function ac() {
            Y.w = Y.w || T.width();
            Y.w = Y.mw && Y.mw < Y.w ? Y.mw : Y.w;
            return Y.w
        }
        function ah() {
            Y.h = Y.h || T.height();
            Y.h = Y.mh && Y.mh < Y.h ? Y.mh : Y.h;
            return Y.h
        }
        T.hide().appendTo(x.show()).css({
            width: ac(),
            overflow: Y.scrolling ? "auto" : "hidden"
        }).css({
            height: ah()
        }).prependTo(h);
        x.hide();
        t("#" + M + "Photo").css({
            cssFloat: "none",
            marginLeft: "auto",
            marginRight: "auto"
        });
        if (aa) {
            t("select").not(z.find("select")).filter(function () {
                return this.style.visibility !== "hidden"
            }).css({
                visibility: "hidden"
            }).one(k, function () {
                this.style.visibility = "inherit"
            })
        }
        function ad(al) {
            var an, ao, ak, aj, am = g.length,
                ai = Y.loop;
            F.position(al, function () {
                function ap() {
                    if (l) {
                        z[0].style.filter = false
                    }
                }
                if (!w) {
                    return
                }
                if (l) {
                    if (ae) {
                        T.fadeIn(100)
                    }
                }
                T.show();
                A(J);
                L.show().html(Y.title);
                if (am > 1) {
                    if (typeof Y.current === "string") {
                        o.html(Y.current.replace(/\{current\}/, C + 1).replace(/\{total\}/, am)).show()
                    }
                    R[(ai || C < am - 1) ? "show" : "hide"]().html(Y.next);
                    p[(ai || C) ? "show" : "hide"]().html(Y.previous);
                    an = C ? g[C - 1] : g[am - 1];
                    ak = C < am - 1 ? g[C + 1] : g[0];
                    if (Y.slideshow) {
                        G.show()
                    }
                    if (Y.preloading) {
                        aj = t.data(ak, r).href || ak.href;
                        ao = t.data(an, r).href || an.href;
                        aj = t.isFunction(aj) ? aj.call(ak) : aj;
                        ao = t.isFunction(ao) ? ao.call(an) : ao;
                        if (v(aj)) {
                            t("<img/>")[0].src = aj
                        }
                        if (v(ao)) {
                            t("<img/>")[0].src = ao
                        }
                    }
                }
                B.hide();
                if (Y.transition === "fade") {
                    z.fadeTo(ag, 1, function () {
                        ap()
                    })
                } else {
                    ap()
                }
                b.bind("resize." + M, function () {
                    F.position(0)
                });
                A(N, Y.onComplete)
            })
        }
        if (Y.transition === "fade") {
            z.fadeTo(ag, 0, function () {
                ad(0)
            })
        } else {
            ad(ag)
        }
    };
    F.load = function (af) {
        var ae, ad, ag, ac = F.prep;
        S = true;
        m = g[C];
        if (!af) {
            Y = Z(t.extend({}, t.data(m, r)))
        }
        A(f);
        A(c, Y.onLoad);
        Y.h = Y.height ? I(Y.height, "y") - e - ab : Y.innerHeight && I(Y.innerHeight, "y");
        Y.w = Y.width ? I(Y.width, "x") - a - i : Y.innerWidth && I(Y.innerWidth, "x");
        Y.mw = Y.w;
        Y.mh = Y.h;
        if (Y.maxWidth) {
            Y.mw = I(Y.maxWidth, "x") - a - i;
            Y.mw = Y.w && Y.w < Y.mw ? Y.w : Y.mw
        }
        if (Y.maxHeight) {
            Y.mh = I(Y.maxHeight, "y") - e - ab;
            Y.mh = Y.h && Y.h < Y.mh ? Y.h : Y.mh
        }
        ae = Y.href;
        B.show();
        if (Y.inline) {
            n().hide().insertBefore(t(ae)[0]).one(f, function () {
                t(this).replaceWith(T.children())
            });
            ac(t(ae))
        } else {
            if (Y.iframe) {
                z.one(J, function () {
                    var ah = t('<iframe id="fcb" name=\'' + new Date().getTime() + "' frameborder=0" + (Y.scrolling ? "" : " scrolling='no'") + (l ? " allowtransparency='true'" : "") + " style='width:100%; height:100%; border:0; display:block;'/>");
                    ah[0].src = Y.href;
                    ah.appendTo(T).one(f, function () {
                        ah[0].src = "//about:blank"
                    })
                });
                ac(" ")
            } else {
                if (Y.html) {
                    ac(Y.html)
                } else {
                    if (v(ae)) {
                        ad = new Image();
                        ad.onload = function () {
                            var ah;
                            ad.onload = null;
                            ad.id = M + "Photo";
                            t(ad).css({
                                border: "none",
                                display: "block",
                                cssFloat: "left"
                            });
                            if (Y.scalePhotos) {
                                ag = function () {
                                    ad.height -= ad.height * ah;
                                    ad.width -= ad.width * ah
                                };
                                if (Y.mw && ad.width > Y.mw) {
                                    ah = (ad.width - Y.mw) / ad.width;
                                    ag()
                                }
                                if (Y.mh && ad.height > Y.mh) {
                                    ah = (ad.height - Y.mh) / ad.height;
                                    ag()
                                }
                            }
                            if (Y.h) {
                                ad.style.marginTop = Math.max(Y.h - ad.height, 0) / 2 + "px"
                            }
                            if (g[1] && (C < g.length - 1 || Y.loop)) {
                                t(ad).css({
                                    cursor: "pointer"
                                }).click(F.next)
                            }
                            if (l) {
                                ad.style.msInterpolationMode = "bicubic"
                            }
                            setTimeout(function () {
                                ac(ad)
                            }, 1)
                        };
                        setTimeout(function () {
                            ad.src = ae
                        }, 1)
                    } else {
                        if (ae) {
                            x.load(ae, function (ai, ah, aj) {
                                ac(ah === "error" ? "Request unsuccessful: " + aj.statusText : t(this).children())
                            })
                        }
                    }
                }
            }
        }
    };
    F.next = function () {
        if (!S) {
            C = C < g.length - 1 ? C + 1 : 0;
            F.load()
        }
    };
    F.prev = function () {
        if (!S) {
            C = C ? C - 1 : g.length - 1;
            F.load()
        }
    };
    F.close = function () {
        if (w && !H) {
            H = true;
            w = false;
            A(k, Y.onCleanup);
            b.unbind("." + M + " ." + U);
            Q.fadeTo("fast", 0);
            z.stop().fadeTo("fast", 0, function () {
                A(f);
                T.remove();
                z.add(Q).css({
                    opacity: 1,
                    cursor: "auto"
                }).hide();
                setTimeout(function () {
                    H = false;
                    A(V, Y.onClosed)
                }, 1)
            })
        }
    };
    F.element = function () {
        return t(m)
    };
    F.settings = D;
    t(F.init)
}($fmpJQ, this));
(function (b) {
    $fmpJQ.browser.mobile = /android.+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|symbian|treo|up\.(browser|link)|vodafone|wap|windows (ce|phone)|xda|xiino/i.test(b) || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|e\-|e\/|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(di|rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|xda(\-|2|g)|yas\-|your|zeto|zte\-/i.test(b.substr(0, 4))
})(navigator.userAgent || navigator.vendor || window.opera);
var Fortumo = {};
Fortumo.isTablet = function () {
    var c = (/gt-p1000|sgh-t849|shw-m180s|a510|a511|a100|gt-i9000|tablet|sch-i800|transformer|a101it|ipad|sch-i800|dell streak|silk|playbook|kindle/i.test(navigator.userAgent.toLowerCase()));
    var b = (/iphone|ipod|(android)?(mobile)|mobile|mobile safari|blackberry|opera mini|opera mobi|skyfire|maemo|windows phone|palm|iemobile|symbian|symbianos|fennec/i.test(navigator.userAgent.toLowerCase()));
    var a = (/android/i.test(navigator.userAgent.toLowerCase()));
    if (c || (!b && a)) {
        return true
    }
    return false
};
$fmpJQ(document).ready(function () {
    $fmpJQ("a#fmp-button").fmpWidget({
        width: "575px",
        height: "590px",
        initialWidth: "575px",
        initialHeight: "590px",
        iframe: true,
        scrolling: false,
        title: 'Mobile Payments by <a target="_blank" href="http://fortumo.com">Fortumo</a>',
        transition: "elastic",
        speed: 500,
        rel: "nofollow",
        overlayClose: false,
        escKey: false
    });
    XD.receiveMessage(function (b) {
        if (b.data.substring(0, 6).toLowerCase() == "fmpid:") {
            XD.setCookie(b.data.substring(6, b.data.length))
        } else {
            setTimeout($fmpJQ.fn.fmpWidget.close, 500);
            if (b.data.substring(0, 7).toLowerCase() == "fmpurl:") {
                window.setTimeout('window.location="' + b.data.substring(7, b.data.length) + '"; ', 1000)
            }
        }
    })
});
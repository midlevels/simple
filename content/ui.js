document.addEventListener("DOMContentLoaded", () => {
    const e = document.getElementById("back-to-top");
    if (e) {
        const t = () => {
                window.scrollY > 300 ? e.classList.add("visible") : e.classList.remove("visible")
            },
            o = () => {
                window.scrollTo({
                    top: 0,
                    behavior: "smooth"
                })
            };
        window.addEventListener("scroll", t),
        e.addEventListener("click", o)
    }
    const t = document.getElementById("theme-toggle"),
        o = document.documentElement,
        d = localStorage.getItem("theme");
    d && o.setAttribute("data-theme", d),
    t && t.addEventListener("click", () => {
        const e = o.getAttribute("data-theme");
        let t = "light";
        t = "dark" === e ? "light" : "light" === e ? "dark" : window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark",
        o.setAttribute("data-theme", t),
        localStorage.setItem("theme", t)
    });
    const c = document.getElementById("not-found-search-trigger");
    c && c.addEventListener("click", () => {
        const e = document.querySelector(".search-trigger");
        e && e.click()
    })
});

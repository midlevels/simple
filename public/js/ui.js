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
    });

    // Mobile sidebar navigation
    const navToggle = document.querySelector(".nav-toggle");
    const navLinks = document.querySelector(".nav-links");
    const navOverlay = document.querySelector(".nav-overlay");

    function openSidebar() {
        navLinks && navLinks.classList.add("is-open");
        navOverlay && navOverlay.classList.add("is-visible");
        // Allow display:block to paint before starting transition
        requestAnimationFrame(() => {
            navOverlay && navOverlay.classList.add("is-open");
        });
        navToggle && navToggle.setAttribute("aria-expanded", "true");
        navToggle && navToggle.setAttribute("aria-label", "Close navigation menu");
        document.body.style.overflow = "hidden";
    }

    function closeSidebar() {
        navLinks && navLinks.classList.remove("is-open");
        navOverlay && navOverlay.classList.remove("is-open");
        navToggle && navToggle.setAttribute("aria-expanded", "false");
        navToggle && navToggle.setAttribute("aria-label", "Open navigation menu");
        document.body.style.overflow = "";
        // Remove is-visible after transition completes (matches --transition-slow: 300ms)
        if (navOverlay) {
            clearTimeout(navOverlay._hideTimer);
            navOverlay._hideTimer = setTimeout(() => {
                if (!navOverlay.classList.contains("is-open")) {
                    navOverlay.classList.remove("is-visible");
                }
            }, 300);
        }
    }

    if (navToggle) {
        navToggle.addEventListener("click", () => {
            const isOpen = navLinks && navLinks.classList.contains("is-open");
            isOpen ? closeSidebar() : openSidebar();
        });
    }

    if (navOverlay) {
        navOverlay.addEventListener("click", closeSidebar);
    }

    // Close sidebar when a nav link is clicked
    if (navLinks) {
        navLinks.querySelectorAll("a").forEach(link => {
            link.addEventListener("click", closeSidebar);
        });
    }

    // Close sidebar on Escape key
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && navLinks && navLinks.classList.contains("is-open")) {
            closeSidebar();
            navToggle && navToggle.focus();
        }
    });
});

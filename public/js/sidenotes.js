!function() {
    "use strict";
    function e() {
        document.querySelectorAll(".fn-ref").forEach(e => {
            e.addEventListener("click", function(e) {
                e.preventDefault(),
                e.stopPropagation();
                const t = this.closest(".fn-wrapper");
                t && (document.querySelectorAll(".fn-wrapper.active").forEach(e => {
                    e !== t && e.classList.remove("active")
                }), t.classList.toggle("active"))
            })
        }),
        document.addEventListener("click", function(e) {
            e.target.closest(".fn-wrapper") || document.querySelectorAll(".fn-wrapper.active").forEach(e => {
                e.classList.remove("active")
            })
        })
    }
    "loading" === document.readyState ? document.addEventListener("DOMContentLoaded", e) : e()
}();

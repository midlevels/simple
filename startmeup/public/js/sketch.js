let size = document.documentElement.scrollHeight + 250;
let hue = 0;
let stepDiv = 10;
let boids = [];
let w = window.innerWidth;

function setup() {
    let myCanvas = createCanvas(w, size);
    myCanvas.parent("myCanvas");
    // background(0);
    strokeWeight(3);
    colorMode(RGB, 1);
    frameRate(30);

    createBoids(9);
}

let functions = [f1, f2, f3];

function createBoids(n) {
    for (let i = 0; i < n; i++) {
        functions = shuffle(functions);
        let boid = {
            f: functions,
            scale: random() / 5 + 0.25,
            x: random() * window.innerWidth,
            y: random() * 400 + 250,
            time: i * 100,
            hue: int(random() * 20 + 200),
            // hue: int(random() *200),
            vx: (random() - 0.5) / 10,
            vy: (random() - 0.5) / 10,
            runaway: false,
        }
        boids.push(boid);
    }
}

function f1(t) {
    let x = 70 * sin(t / 10) + 70 * sin(t / 3) + size / 2;
    let y = 70 * cos(t / 12) + 70 * cos(t / 2) + size / 2;
    return { x, y };
}

function f2(t) {
    let x = 10 * sin(t / 5) + 130 * sin(t / 12) + size / 2;
    let y = cos(t / 5) + 100 * cos(t / 2) + size / 2;
    return { x, y };
}

function f3(t) {
    let x = 70 * sin(t / 10) + 10 * sin(t / 2) + size / 2;
    let y = 40 * cos(t / 2) + 40 * cos(t / 3) + size / 2;
    return { x, y };
}

function drawLine(func1, func2, t, m = 1, xOff = 0, yOff = 0) {
    p1 = func1(frameCount/3  + t / stepDiv);
    p2 = func2(frameCount/3  + t / stepDiv);
    // stroke(`hsla(370, 80%, 75%, 0.25)`);
    line(p1.x * m + xOff, p1.y * m + yOff, p2.x * m + xOff, p2.y * m + yOff);
}

function draw() {

    if (w != window.innerWidth) {
        w = window.innerWidth;
        resizeCanvas(w, size);
    }
    clear();
    // background(`hsla(${50}, 80%, 75%, 0.05)`);
    // background(0, 0, 0, 0.2);
    // background();

    

    for (let i = 0; i < boids.length; i++) {
        let b = boids[i];
        for (let t = 0; t < 50; t++) {
            stroke(1, 1, 1, 0.2);
            stroke(`hsla(${b.hue+int(t/3)}, 65%, 85%, 0.25)`);
            drawLine(b.f[0], b.f[1], t + b.time, b.scale, b.x, b.y);
            drawLine(b.f[1], b.f[2], t + b.time, b.scale, b.x, b.y);
            b.x += b.vx;
            b.y += b.vy;

            if (b.x < 0 || b.x > w && b.vx != 0 ) {
                if (random() < 0.9) {
                    b.vx = (random() - 0.5) / 10;
                } else {
                    b.vx = 0;
                }
            }

            if (b.y < 280 || b.y > size - 10 && !b.runaway) {
                b.runaway = true;
                let r = random(10);
                if (r < 6) {
                    b.vy = (random() - 0.5) / 10;
                } else {
                    b.runaway = true;
                }
            }
        }
    }
}

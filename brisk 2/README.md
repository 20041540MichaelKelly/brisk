# Brisk

Brisk is one small language for the frontend and the backend. A whole app, with its saved
data, its server and its screen, fits in a single file, and the compiler writes the wiring
between the two sides.

```brisk
data Task
  text: text
  done: yes/no
end

server fn addTask(text)
  save Task { text: text, done: false }
end

screen
  ui.title("Tasks")
  let box = ui.input("What needs doing?")
  ui.button("Add", fn -> addTask(box.value))
  ui.list((all Task).map(fn(t) -> t.text))
end
```

```
node bin/brisk.js serve tasks.brisk
```

That is a working app at `http://localhost:3000`. Tapping **Add** calls `addTask` on the
backend, the task is saved to a file, and the screen redraws. There is no API code, no
fetch call and no second project.

Brisk uses plain words (`and`, `is`, `end`) in place of most symbols, so it is quick to
type. It checks your program before running it, and every error names the file and line.

You need [Node.js](https://nodejs.org) 18 or newer. There is nothing else to install.

## See it work

`examples/showcase/board.brisk` is a feature-voting board in about 130 lines. It has saved
data, startup code, checked backend functions, a JSON API, a screen with a chart, a helper
file and tests.

```
node bin/brisk.js serve examples/showcase/board.brisk
node bin/brisk.js run examples/showcase/stats.test.brisk
```

## Set up in VS Code

1. Clone this repository and open the folder in VS Code.
2. Install the Brisk extension for syntax colours, indentation and snippets, then restart VS Code:

   ```
   npm run vscode
   ```

3. Open `examples/hello.brisk` and press **Ctrl+Shift+B** (**Cmd+Shift+B** on a Mac) to run the
   file you have open. Mistakes appear in the Problems panel with their line numbers.
4. For an app with a backend, open `examples/tasks.brisk`, choose **Terminal > Run Task**, then
   **Brisk: serve this file**.

To use the `brisk` command from any folder, run `npm link` once in this folder. After that,
replace `node bin/brisk.js` with `brisk` in the commands below.

## Commands

| Command | What it does |
| --- | --- |
| `node bin/brisk.js run file.brisk` | Runs a script, then its tests |
| `node bin/brisk.js serve file.brisk` | Runs an app with a backend at `http://localhost:3000`. Add `--port 4000` to change the port |
| `node bin/brisk.js check file.brisk` | Reports mistakes without running anything |
| `node bin/brisk.js build file.brisk` | Writes a `.js` file, a web page, or a folder ready to deploy |
| `node bin/brisk.js build file.brisk --preview` | Writes one web page that needs no server, for showing an app to someone |
| `node bin/brisk.js bench file.brisk` | Measures compile speed on your machine |
| `npm test` | Runs Brisk's own checks |

## The basics

```brisk
# A comment

let name = "Mick"        # a value that never changes
var score = 0            # a value that can change
score = score + 1

say "Hi {name}, you have {score} points"    # {…} drops a value into a string

fn add(a, b)
  return a + b
end

let double = fn(n) -> n * 2                 # a one-line function

if score > 10 and name is "Mick"
  say "winning"
else if score == 0
  say "just started"
else
  say "keep going"
end

for i in 1..5            # counts 1, 2, 3, 4, 5
  say i
end

for snack in ["tea", "toast", "jam"]
  say snack
end

while score < 3
  score = score + 1
end

repeat 3
  say "again"
end
```

| Brisk | Meaning |
| --- | --- |
| `and`, `or`, `not` | `&&`, `\|\|`, `!` |
| `is`, `==` | strictly equal |
| `isnt`, `!=` | not equal |
| `nil` | no value (`null`) |
| `fn(x) -> x * 2` | a one-line function |
| `\{` and `\}` | a real brace inside a string |

Anything Brisk does not change is passed through as JavaScript, so its built-in functions
all work: `Math.round(x)`, `list.push(item)`, `text.toUpperCase()`, `Number("42")`.

## Mistakes are caught before the program runs

```
main.brisk:3: "totl" is not defined. Did you mean "total"?
main.brisk:9: "add" takes 2 values, but this line gives it 3.
main.brisk:14: Task has no field "titel". Did you mean "title"?
main.brisk:20: This "if" is missing its "end"
```

Brisk checks that every name exists, that your own functions get the right number of
values, that saved records only use fields their `data` block declares, and that blocks,
brackets and strings are closed. The same checks run across the frontend and the backend,
so a screen that calls a server fn wrongly is an error before anything starts.

## Saved data

A `data` block describes a kind of record. Field types are `text`, `number`, `yes/no`,
`list` and `any`.

```brisk
data Note
  title: text
  stars: number
end

let note = save Note { title: "First" }     # stars starts at 0; every record gets an id
update note { stars: 5 }
for n in all Note
  say "{n.title}: {n.stars}"
end
remove note
```

Saving a wrong field or a wrong type is an error that says which one. Where the data lives
depends on the program:

- A script or a backend keeps it in a JSON file beside the program, such as `tasks.data.json`.
- An app with a screen and no backend keeps it on the device, in the browser's storage.

## Frontend: `screen` and `ui`

Everything inside `screen` is the frontend. It is drawn again whenever saved data changes,
so you describe what the screen shows and never update it by hand. Text typed into inputs
is kept across redraws.

| Call | What you get |
| --- | --- |
| `ui.title("text")` | A heading, and the page title |
| `ui.text("text")` | A line of text. Change it with `.set("new text")` |
| `ui.input("hint")` | A text box. Read or set it with `.value` |
| `ui.button("Label", myFn)` | A button that runs a function when tapped |
| `ui.list(items)` | A bulleted list |
| `ui.canvas(300, 300)` | A drawing area with `clear`, `rect`, `circle`, `text` and `onTap(myFn)` |
| `ui.every(16, myFn)` | Runs a function every 16 milliseconds, for animation |
| `ui.after(1000, myFn)` | Runs a function once, after a second |
| `ui.stop(timer)` | Stops a timer |
| `ui.background("#eef1f4")` | Sets the page colour |

Text, input, button and list items also have `.hide()`, `.show()`, `.color("red")` and `.remove()`.

A program that uses `ui.` and has no backend builds to one self-contained HTML file:

```
node bin/brisk.js build examples/tip-splitter.brisk
```

## Backend: `server fn` and `route`

A `server fn` runs on the backend. Call it from the screen like any other function: Brisk
sends the request, and redraws the screen with the fresh data when the answer arrives. Its
body never reaches the browser, so keys and private logic stay on the server.

```brisk
server fn finish(task)
  update task { done: true }
end
```

When an app has a backend, data can only be changed inside a `server fn` or a `route`.
Brisk reports an error if a screen tries to change it directly.

`fail` stops a server fn with a message. The data is left alone and the message is shown
at the top of the screen:

```brisk
server fn addIdea(title)
  if title.length < 4
    fail "An idea needs at least 4 letters"
  end
  return save Idea { title: title, votes: 1 }
end
```

A `server` block with no name runs once, when the backend starts. Use it to add starting data:

```brisk
server
  if (all Idea).length is 0
    save Idea { title: "First idea", votes: 1 }
  end
end
```

A `route` is a plain URL, for when you want an API with no screen:

```brisk
route GET "/hello/:name"
  return "Hello {req.params.name}"
end

route POST "/notes"
  return save Note { title: req.body.title }
end
```

`req.params` holds the `:name` parts of the path, `req.query` holds what follows `?`, and
`req.body` holds the JSON that was sent. Returning text sends text; returning anything else
sends JSON.

To use an npm package on the backend, install it and call `require` inside a server fn:

```brisk
server fn today()
  let dayjs = require("dayjs")
  return dayjs().format("D MMMM")
end
```

## More than one file

```brisk
use "lib/words.brisk"

say countWords("one two three")
```

`use` runs the other file first and makes its functions, values and data shapes available.
Paths are relative to the file that contains the `use`.

## Tests

```brisk
test "add works"
  expect add(2, 3) == 5
end
```

`brisk run` runs every test after the program and prints which passed and which failed.

## Deploying

```
node bin/brisk.js build examples/tasks.brisk -o dist
node dist/app.js
```

For an app with a backend, `build` writes a folder with no dependencies. It runs anywhere
Node runs, and it listens on the `PORT` environment variable, which is what most hosts expect.

`build --preview` writes a single HTML file instead. The backend code runs in the browser
and data is kept on the device, so the file works anywhere with no server. It is for demos:
everything in it, including the backend code, is visible to whoever opens it, and routes are left out.

## Limits

- Brisk checks names, argument counts, data fields and structure. It does not check the types
  of ordinary values, so `"a" * 2` is not an error.
- Name checking treats the whole program as one scope. A name used outside the block that
  defines it is not reported.
- A block body cannot go inside brackets. One-line actions use `fn -> ...`; longer ones need a named `fn`.
- A statement has to fit on one line, unless it is inside `( )`, `[ ]` or `{ }`.
- Saved data lives in one JSON file, which suits small apps. It is not a database: there are no
  queries beyond `all`, and no protection if two servers write at once.
- There are no user accounts or permissions yet. Anyone who can reach the server can call its server fns.
- Screens redraw after your own changes. They do not yet update when another user changes the data.

## How it works

The compiler never builds a syntax tree. It walks the source once, writes JavaScript as it
goes, and notes names and calls for the checks at the end. Every Brisk line becomes exactly
one JavaScript line, which is why error line numbers always match your source.

The same file is compiled twice. The backend build leaves out `screen` blocks. The frontend
build leaves out the bodies of server fns and routes, and replaces each server fn with a small
function that calls the backend.

Run `node bin/brisk.js bench examples/hello.brisk` to see the compile speed on your machine.

## Layout

| Path | Contents |
| --- | --- |
| `src/compiler.js` | The compiler and checker |
| `src/project.js` | Finds the files a program uses and compiles them in order |
| `src/data.js` | Saved data, shared by both sides |
| `src/node.js` | The backend runtime and HTTP server |
| `src/web.js` | The `ui` library and the page that frontends are built into |
| `bin/brisk.js` | The command line |
| `vscode-brisk/` | The VS Code extension |
| `examples/` | Programs to start from |
| `test/run.js` | Brisk's own checks |

## Roadmap

1. Error squiggles and autocomplete in VS Code as you type.
2. Breakpoints that stop on Brisk lines.
3. Screens that update live when another user changes the data.
4. User accounts, so a server fn can know who is calling it.
5. An online playground, and `brisk` on npm.

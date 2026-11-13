# Brisk

Brisk is a small language that compiles to JavaScript. It uses plain words instead of symbols
(`and`, `or`, `is`, `end`), so it is quick to type, and its compiler makes a single pass over
the source, so it is quick to build.

```brisk
let name = "Mick"

fn greet(who)
  say "Hello {who}"
end

greet(name)
```

You need [Node.js](https://nodejs.org) 18 or newer. There is nothing else to install.

## Set up in VS Code

1. Clone this repository and open the folder in VS Code.
2. Install the Brisk extension for syntax colours, indentation and snippets:

   ```
   npm run vscode
   ```

   This copies the `vscode-brisk` folder into your VS Code extensions folder. Restart VS Code afterwards.
3. Open `examples/hello.brisk` and press **Ctrl+Shift+B** (**Cmd+Shift+B** on a Mac). That runs the
   file you have open and shows the output in the terminal panel. Compile errors appear in the
   Problems panel with their line numbers.

To use the `brisk` command from any folder, run `npm link` once in this folder.

## Commands

| Command | What it does |
| --- | --- |
| `node bin/brisk.js run file.brisk` | Compiles and runs the file, then runs its tests |
| `node bin/brisk.js build file.brisk` | Writes `file.js`, or `file.html` if the program is an app |
| `node bin/brisk.js build file.brisk -o out.js` | Same, with your own output name |
| `node bin/brisk.js bench file.brisk` | Measures compile speed on your machine |
| `npm test` | Runs the compiler's own checks |

After `npm link`, replace `node bin/brisk.js` with `brisk`.

## The language

```brisk
# A comment

let name = "Mick"        # a value that never changes
var score = 0            # a value that can change
score = score + 1

say "Hi {name}, you have {score} points"    # {…} drops a value into a string

fn add(a, b)
  return a + b
end

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

let snacks = ["tea", "toast", "jam"]
for snack in snacks      # goes through a list
  say snack
end

var n = 3
while n > 0
  n = n - 1
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
| `\{` and `\}` | a real brace inside a string |

Anything Brisk does not change is passed through as JavaScript, so you can use JavaScript's
built-in functions: `Math.round(x)`, `list.push(item)`, `text.toUpperCase()`, `Number("42")`.

### Tests

```brisk
test "add works"
  expect add(2, 3) == 5
end
```

`brisk run` runs every test after the program and prints which passed and which failed.

## Writing apps

A program that uses `ui.` is an app. `brisk build` turns it into one self-contained HTML file
that you can open in a browser, host anywhere, or wrap for a phone.

```brisk
ui.title("Tip splitter")
let bill = ui.input("Bill total")
let people = ui.input("How many people")
let result = ui.text("Enter the bill, then tap Split")

fn split()
  let each = (Number(bill.value) / Number(people.value)).toFixed(2)
  result.set("Each person pays {each}")
end

ui.button("Split", split)
```

```
node bin/brisk.js build examples/tip-splitter.brisk
```

Then open `examples/tip-splitter.html` in a browser.

| Call | What you get |
| --- | --- |
| `ui.title("text")` | A heading, and the page title |
| `ui.text("text")` | A line of text. Change it later with `.set("new text")` |
| `ui.input("hint")` | A text box. Read it with `.value` |
| `ui.button("Label", myFn)` | A button that runs `myFn` when tapped |
| `ui.list(items)` | A bulleted list. Replace it with `.set(newItems)` |
| `ui.canvas(300, 300)` | A drawing area with `clear`, `rect`, `circle`, `text` and `onTap(myFn)` |
| `ui.every(16, myFn)` | Runs `myFn` every 16 milliseconds, for animation |
| `ui.after(1000, myFn)` | Runs `myFn` once, after a second |
| `ui.stop(timer)` | Stops a timer from `every` or `after` |
| `ui.background("#eef1f4")` | Sets the page colour |
| `ui.clear()` | Removes everything from the screen |

Text, input, button and list items also have `.hide()`, `.show()`, `.color("red")` and `.remove()`.

`examples/bounce.brisk` shows a canvas game loop.

## Limits

- Brisk does no type checking. It reports mistakes in Brisk's own structure, such as a missing `end`
  or an unclosed string or bracket. Other mistakes show up as JavaScript errors when the program runs.
- Blocks cannot be written inside brackets, so a button's action has to be a named `fn`.
- A statement has to fit on one line, unless it is inside `( )`, `[ ]` or `{ }`.
- `brisk run` cannot run apps, because they need a browser. It builds the page and tells you where it is.
- There are no imports yet. A program is one file.

## How it is fast

The compiler never builds a syntax tree. It walks the source once, character by character, and
writes JavaScript as it goes, copying unchanged stretches of text in one piece. Every Brisk line
becomes exactly one JavaScript line, which is also why error line numbers match your source.

It is quick because it does much less work than a compiler such as TypeScript's, which also
checks types. Run `node bin/brisk.js bench examples/hello.brisk` to see the figure on your machine.

## Layout

| Path | Contents |
| --- | --- |
| `src/compiler.js` | The compiler |
| `src/page.js` | The `ui` library and the HTML page that apps are built into |
| `bin/brisk.js` | The command line |
| `vscode-brisk/` | The VS Code extension |
| `examples/` | Programs to start from |
| `test/run.js` | Checks for the compiler |

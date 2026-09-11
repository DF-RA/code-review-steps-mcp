/**
 * The little syntax highlighter of the draft page.
 *
 * Without it a snippet of an added file is a block of one colour: the band that
 * says "the pull request added this" ends up being the only thing you see, and
 * the code under it stops reading as code. Colouring the tokens is what lets the
 * band stay in the background, which is how a diff is meant to look.
 *
 * It is one scanner for every language on purpose. A real grammar per language
 * is a dependency, and the page loads nothing from the internet: strings,
 * comments, numbers, keywords and calls are what carry almost all of the colour,
 * and those look the same in the languages this reviews.
 */

export const TOKEN_CLASSES = ["k", "s", "c", "n", "f", "y", "o"] as const;

/**
 * What a piece of a line is: keyword, string, comment, number, function, type,
 * operator. Anything else carries no class and is painted as plain text.
 */
export type TokenClass = (typeof TOKEN_CLASSES)[number];

export type Token = { t: string; c?: TokenClass };

/** How a language writes a comment. */
export type CommentFlavor = "c" | "hash";

const HASH_COMMENT = new Set([
  "py", "rb", "sh", "bash", "zsh", "fish", "pl", "r", "jl", "nim", "ex", "exs",
  "yml", "yaml", "toml", "ini", "cfg", "conf", "tf", "tfvars", "mk", "cmake",
  "gitignore", "dockerignore", "env", "properties",
]);

const HASH_NAMES = new Set(["dockerfile", "makefile", "gemfile", "rakefile", "procfile"]);

/** Which comment a file writes, from its name. */
export function flavorOf(path: string): CommentFlavor {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const dot = name.lastIndexOf(".");
  const extension = dot === -1 ? "" : name.slice(dot + 1);

  return HASH_NAMES.has(name) || HASH_COMMENT.has(extension) ? "hash" : "c";
}

/*
 * One list for every language: a word that is a keyword somewhere is almost
 * never an ordinary name somewhere else, and colouring it does no harm when it
 * is. The alternative is a table per language, which is a grammar by instalments.
 */
const KEYWORDS = new Set([
  "abstract", "and", "as", "assert", "async", "await", "break", "case", "catch",
  "class", "const", "constructor", "continue", "data", "def", "default", "defer",
  "del", "delete", "do", "elif", "else", "elseif", "end", "enum", "except",
  "export", "extends", "extension", "final", "finally", "fn", "for", "from",
  "fun", "func", "function", "go", "goto", "guard", "if", "impl", "implements",
  "import", "in", "init", "instanceof", "interface", "is", "lambda", "let",
  "match", "mod", "module", "mut", "namespace", "new", "not", "object",
  "operator", "or", "override", "package", "pass", "private", "protected", "pub",
  "public", "raise", "readonly", "record", "ref", "require", "return",
  "satisfies", "sealed", "select", "static", "struct", "suspend", "switch",
  "synchronized", "then", "throw", "throws", "trait", "try", "type", "typeof",
  "union", "unless", "until", "use", "using", "val", "var", "void", "when",
  "where", "while", "with", "yield",
]);

/** Words that are a value, not a name: they read better in the number's colour. */
const CONSTANTS = new Set([
  "true", "false", "null", "nil", "none", "undefined", "nan", "infinity",
  "True", "False", "None", "self", "this", "super",
]);

const OPERATOR = /^[=+\-*/%<>!&|^~?:]+$/u;

/**
 * Everything that is not a comment and not the start of one, in one pass.
 * A string keeps its opening quote even when the line ends before the closing
 * one: half a string is still a string to whoever reads it.
 */
const TOKEN =
  /\s+|[A-Za-z_$][A-Za-z0-9_$]*|\d[\w.]*|"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|`(?:\\.|[^`\\])*`?|[^\sA-Za-z0-9_$]/guy;

function classOfWord(word: string, rest: string): TokenClass | undefined {
  if (KEYWORDS.has(word)) {
    return "k";
  }

  if (CONSTANTS.has(word)) {
    return "n";
  }

  // A name followed by a parenthesis is being called, or declared to be.
  if (/^\s*\(/u.test(rest)) {
    return "f";
  }

  return /^[A-Z]/u.test(word) ? "y" : undefined;
}

interface Sink {
  push(text: string, cls?: TokenClass): void;
}

/** Tokenises one line, from `open` if it starts inside a block comment. */
function scan(line: string, flavor: CommentFlavor, open: boolean, sink: Sink): boolean {
  let index = 0;
  let inBlock = open;

  if (inBlock) {
    const close = line.indexOf("*/");

    if (close === -1) {
      sink.push(line, "c");
      return true;
    }

    sink.push(line.slice(0, close + 2), "c");
    index = close + 2;
    inBlock = false;
  }

  while (index < line.length) {
    const rest = line.slice(index);

    if ((flavor === "c" && rest.startsWith("//")) || (flavor === "hash" && rest.startsWith("#"))) {
      sink.push(rest, "c");
      return false;
    }

    if (flavor === "c" && rest.startsWith("/*")) {
      const close = rest.indexOf("*/", 2);

      if (close === -1) {
        sink.push(rest, "c");
        return true;
      }

      sink.push(rest.slice(0, close + 2), "c");
      index += close + 2;
      continue;
    }

    TOKEN.lastIndex = index;
    const match = TOKEN.exec(line);

    if (!match) {
      // Nothing the scanner knows: it is still a character of the line.
      sink.push(rest);
      return inBlock;
    }

    const text = match[0];
    const after = line.slice(index + text.length);

    if (/^[A-Za-z_$]/u.test(text)) {
      sink.push(text, classOfWord(text, after));
    } else if (/^\d/u.test(text)) {
      sink.push(text, "n");
    } else if (/^["'`]/u.test(text)) {
      sink.push(text, "s");
    } else if (OPERATOR.test(text)) {
      sink.push(text, "o");
    } else {
      sink.push(text);
    }

    index += text.length;
  }

  return inBlock;
}

/**
 * Colours a block of lines, keeping what a line leaves open.
 *
 * Taken together and not one by one because a block comment spans lines, and
 * this codebase is written in them: highlighting each line on its own would
 * paint the inside of every doc comment as if it were code.
 */
export function highlight(lines: string[], flavor: CommentFlavor = "c"): Token[][] {
  const out: Token[][] = [];
  let open = false;

  for (const line of lines) {
    const tokens: Token[] = [];
    const sink: Sink = {
      push(text, cls) {
        if (text === "") {
          return;
        }

        // Runs of the same colour are joined: fewer spans on the page, and the
        // scanner can emit a name and its dot separately without it showing.
        const last = tokens[tokens.length - 1];

        if (last && last.c === cls) {
          last.t += text;
          return;
        }

        tokens.push(cls ? { t: text, c: cls } : { t: text });
      },
    };

    open = scan(line, flavor, open, sink);
    out.push(tokens);
  }

  return out;
}

/** The line as text, which is what the tokens are a colouring of. */
export function textOf(tokens: Token[]): string {
  return tokens.map((token) => token.t).join("");
}

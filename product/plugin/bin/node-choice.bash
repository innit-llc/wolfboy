# node-choice.bash: sourced, never run. The one place that decides which `node` runs the program and with what
# environment, for both ways into it: bin/legal-scan, the launcher the skills call, and bin/legal-hook, the
# shim every entry of hooks/hooks.json runs. Each sources this file under `/bin/bash -p`, with its own folder as the one
# argument (`. "$dir/node-choice.bash" "$dir"`), and then reads LEGAL_NODE.
#
# THE RULE: the plugin's folder, and so the program and every path that follows
# from it, comes from the file system, never from a variable. The caller's folder is the folder of its own $0, which
# only the command line gives, resolved physically (bin/legal-scan says how); this file takes it as its first argument
# and never reads BASH_SOURCE, which bash takes from the environment when a variable of that name is set there. A first
# argument that is not an absolute path names no plugin: LEGAL_PLUGIN_ROOT and LEGAL_CLI_DIR are then empty, and the
# caller refuses.
#
# The environment: four groups of variables a project's own settings can set are removed, each by name or prefix.
# - LEGAL_BUNDLE_DIR: a bundle chooses every rule a scan runs, so on the plugin's route the program
#   finds the bundle shipped with it; an explicit --bundle still wins. Outside the plugin (the CLI run directly) the
#   variable keeps its meaning.
# - Every PRODUCT_CLI_* variable, the program's own switches (host-env.ts PROGRAM_ENV_PREFIX), including any
#   added later: they change what a scan can find.
# - Every NODE_* variable but NODE_EXTRA_CA_CERTS: NODE_OPTIONS can preload code, and the others change
#   module lookup, debug output, coverage files and certificate checks. NODE_EXTRA_CA_CERTS only adds certificate
#   authorities, which a network that inspects HTTPS needs for a declaration fetched by URL.
# - Every OPENSSL_* variable, and CTLOG_FILE and RANDFILE:
#   Node reads OPENSSL_CONF at start-up, before the program's first line, and a configuration there (with
#   OPENSSL_CONF_INCLUDE for its includes) can activate an OpenSSL provider or engine, a native library whose code
#   then runs inside this `node`; OPENSSL_MODULES and OPENSSL_ENGINES choose the folder such a library is loaded from,
#   and the rest (OPENSSL_TRACE, OPENSSL_MALLOC_*, the CPU capability masks such as OPENSSL_ia32cap) change tracing,
#   allocation or which machine code runs. CTLOG_FILE and RANDFILE are the other paths OpenSSL's own list of
#   variables (openssl-env(7)) says it reads files from. Kept: SSL_CERT_FILE and SSL_CERT_DIR, certificates Node
#   reads only under --use-openssl-ca or --use-system-ca, which only NODE_OPTIONS or NODE_USE_SYSTEM_CA (removed
#   above) could turn on here, and which the `git` the program starts may need. A person who needs an OpenSSL
#   configuration (FIPS) for the program cannot give it through this plugin's launchers.
# - GCONV_PATH and LOCPATH: the folders glibc loads character-set
#   conversion modules (native code) and locale data from, so `node` does not inherit a project's modules. Bash itself
#   reads them before this file's first line runs, as the dynamic loader reads LD_PRELOAD, and no line here can close
#   that (bin/legal-scan's note says so).
# Every name is matched in any case: on native Windows the
# environment's names are case-insensitive, so Node and OpenSSL read `node_options` or `Openssl_Conf` as NODE_OPTIONS
# and OPENSSL_CONF, while bash keeps the case it was given. On Linux and macOS the other spellings are other variables,
# which nothing reads; removing them changes nothing there.
#
# The node: the first `node` on PATH that is an executable file in an absolute folder outside the project, where the
# project is both CLAUDE_PROJECT_DIR and the working folder (either one alone can be pointed
# elsewhere). A relative PATH entry is skipped, and each folder is compared by its real path, so a symbolic link into
# the project is skipped too. LEGAL_NODE is empty when no such node exists; the caller then refuses.
# LEGAL_PROJECT is the folder a refusal names (CLAUDE_PROJECT_DIR, else the working folder).
#
# The program: LEGAL_CLI_DIR, the folder of the CLI package the plugin runs, found from the caller's own folder (the rule
# above) and never on PATH or anywhere a project's settings can point:
# - an installed plugin IS the CLI's package: the npm package carries the plugin's files at its root, so the plugin's
#   folder holds package.json and dist/ beside .claude-plugin/, bin/ and the rest, and Claude Code installs the plugin
#   from that package (the marketplace entry's npm source) with its dependencies, pinned by its npm-shrinkwrap.json;
# - the source checkout keeps the two apart (product/plugin beside product/packages/cli), and only a plugin folder with
#   no package.json of its own is read that way, for development with --plugin-dir. Every folder is resolved physically,
#   the plugin's before its ../packages/cli is looked for, so a plugin folder reached through a link chooses the
#   package beside the plugin itself, never one beside the link.
# LEGAL_CLI_DIR is empty where neither exists; the caller then refuses. legal_cli_refusal (both callers call it) sets
# LEGAL_CLI_REFUSAL to the refusal where the program's packages are not installed (an installed plugin with no
# node_modules) or where the plugin's version (.claude-plugin/plugin.json) and the program's (package.json) differ or
# either cannot be read: the two are released together, and a skill or hook of one version driving a program of another
# is refused, never run. The launcher prints it; the hooks' shim treats it as a hook that could not run.
#
# Only shell builtins run here (no dirname, mktemp or here-string), so no program on PATH and no temporary folder is
# used before the node is chosen.
for legal_v in $(compgen -v); do
  case "$legal_v" in
    [Nn][Oo][Dd][Ee]_[Ee][Xx][Tt][Rr][Aa]_[Cc][Aa]_[Cc][Ee][Rr][Tt][Ss]) ;;
    [Ll][Ee][Gg][Aa][Ll]_[Bb][Uu][Nn][Dd][Ll][Ee]_[Dd][Ii][Rr] | [Pp][Rr][Oo][Dd][Uu][Cc][Tt]_[Cc][Ll][Ii]_* | \
      [Nn][Oo][Dd][Ee]_* | [Oo][Pp][Ee][Nn][Ss][Ss][Ll]_* | [Cc][Tt][Ll][Oo][Gg]_[Ff][Ii][Ll][Ee] | [Rr][Aa][Nn][Dd][Ff][Ii][Ll][Ee] | \
      [Gg][Cc][Oo][Nn][Vv]_[Pp][Aa][Tt][Hh] | [Ll][Oo][Cc][Pp][Aa][Tt][Hh])
      unset "$legal_v"
      ;;
  esac
done
unset legal_v

legal_cwd="$(pwd -P 2>/dev/null)" || legal_cwd="${PWD:-}"
if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
  legal_named="$(cd "$CLAUDE_PROJECT_DIR" 2>/dev/null && pwd -P)" || legal_named="$CLAUDE_PROJECT_DIR"
else
  legal_named="$legal_cwd"
fi
LEGAL_PROJECT="$legal_named"
LEGAL_NODE=""
legal_rest="${PATH:-}:"
# A folder that holds no executable `node` is passed over before its real path is
# read: reading it takes a subshell, a new process on every PATH entry, which under Git Bash on native Windows cost some
# 0.2 s of every hook call (measured in the record). Only a folder whose path has no `..` part is passed over so: there
# the kernel's lookup of `<folder>/node` and the folder `cd` reaches are one folder, so a folder passed over here is one
# the rule below would pass over too; a path with `..` is read as before. The rule itself, on the real path, is unchanged.
while [ -n "$legal_rest" ]; do
  legal_d="${legal_rest%%:*}"
  legal_rest="${legal_rest#*:}"
  case "$legal_d" in /*) ;; *) continue ;; esac
  case "$legal_d" in
    .. | */.. | ../* | */../*) ;;
    *) { [ -f "$legal_d/node" ] && [ -x "$legal_d/node" ]; } || continue ;;
  esac
  legal_real="$(cd "$legal_d" 2>/dev/null && pwd -P)" || continue
  case "$legal_real/" in "$legal_named"/*) continue ;; esac
  if [ -n "$legal_cwd" ]; then
    case "$legal_real/" in "$legal_cwd"/*) continue ;; esac
  fi
  if [ -f "$legal_real/node" ] && [ -x "$legal_real/node" ]; then
    LEGAL_NODE="$legal_real/node"
    break
  fi
done
unset legal_rest legal_d legal_real legal_cwd legal_named

legal_bin="${1:-}"
LEGAL_PLUGIN_ROOT=""
case "$legal_bin" in
  /*) LEGAL_PLUGIN_ROOT="$(cd -P -- "$legal_bin/.." 2>/dev/null && pwd -P)" || LEGAL_PLUGIN_ROOT="" ;;
esac
LEGAL_CLI_DIR=""
if [ -n "$LEGAL_PLUGIN_ROOT" ]; then
  if [ -f "$LEGAL_PLUGIN_ROOT/package.json" ]; then
    LEGAL_CLI_DIR="$LEGAL_PLUGIN_ROOT"
  elif [ -d "$LEGAL_PLUGIN_ROOT/../packages/cli" ]; then
    LEGAL_CLI_DIR="$(cd -P -- "$LEGAL_PLUGIN_ROOT/../packages/cli" 2>/dev/null && pwd -P)" || LEGAL_CLI_DIR=""
  fi
fi
unset legal_bin
# LEGAL_CLI_NODE_DIR: LEGAL_CLI_DIR as the node that runs the program opens it, the folder both callers hand node their
# entry from. On native Windows the shell is MSYS's bash and node a
# Windows program: LEGAL_CLI_DIR is a path as that bash writes it (`/c/Users/...`, or `/tmp/...` for a folder under the
# Windows temporary folder), which node reads as another folder, and MSYS's own conversion of a program's arguments
# leaves a path holding `'` unconverted, and every path where MSYS_NO_PATHCONV is set. So there the folder's Windows
# form is taken from the file system by `pwd -W`, a builtin only MSYS's bash has. Everywhere else `pwd -W` is refused
# and the folder is LEGAL_CLI_DIR itself.
LEGAL_CLI_NODE_DIR="$LEGAL_CLI_DIR"
if [ -n "$LEGAL_CLI_DIR" ] && legal_w="$(cd -P -- "$LEGAL_CLI_DIR" 2>/dev/null && pwd -W 2>/dev/null)" && [ -n "$legal_w" ]; then
  LEGAL_CLI_NODE_DIR="$legal_w"
fi
unset legal_w

# The value of the first "version" member in the JSON file $1 (the top-level one in a package.json or a plugin.json,
# which name it before any nested object does), into legal_v; empty where the file or the member is missing.
legal_version_of() {
  legal_v=""
  [ -f "$1" ] || return 0
  while IFS= read -r legal_l || [ -n "$legal_l" ]; do
    case "$legal_l" in
      *'"version"'*:*'"'*)
        legal_l="${legal_l#*\"version\"}"
        legal_l="${legal_l#*:}"
        legal_l="${legal_l#*\"}"
        legal_v="${legal_l%%\"*}"
        break
        ;;
    esac
  done <"$1"
  unset legal_l
  return 0
}

# The node_modules folder npm installed $1 into, in legal_above: $1's physical parent (one level more under an
# `@scope`) where that folder is named node_modules, as `<folder>/node_modules/<name>` or
# `<folder>/node_modules/@<scope>/<name>`; empty where $1 is not in one.
# That is where npm puts a package's dependencies when it installs the package into another folder (a local
# `npm install`, npx), and where Node finds them. Only that one folder: an earlier version also accepted the node_modules
# of any folder above $1, so a plugin whose own dependency install failed - Claude Code's plugin cache is never inside a
# node_modules folder - ran on packages found above the cache instead of being refused, which on native Windows reaches
# C:\node_modules, a folder any local user may create. Read
# from $1's own path, so no variable is read.
legal_modules_above() {
  legal_above="${1%/*}"
  case "${legal_above##*/}" in @*) legal_above="${legal_above%/*}" ;; esac
  case "${legal_above##*/}" in
    node_modules) ;;
    *) legal_above="" ;;
  esac
}

# Whether every package the "dependencies" member of $1/package.json names is installed in one of the node_modules
# folders named after it ($2, and $3 where it is not empty): a folder of that name there that holds its own package.json
#. Until this change the plugin's own node_modules was taken as
# installed wherever the folder existed: an install that stopped after npm made the folder left it empty or partial, and
# Node then looked for the packages in the node_modules of every folder above the plugin's cache - on native Windows
# C:\node_modules - and ran what it found there, or stopped with a stack.
# The first name found in neither is left in legal_missing for the refusal. False where package.json names no
# "dependencies" member, or where a name would leave the folder ("..", or a leading "/").
legal_dependencies_in() {
  legal_missing=""
  legal_text=""
  legal_ok=1
  if [ -f "$1/package.json" ]; then
    while IFS= read -r legal_l || [ -n "$legal_l" ]; do legal_text="$legal_text $legal_l"; done <"$1/package.json"
  fi
  case "$legal_text" in
    *'"dependencies"'*:*'{'*)
      legal_ok=0
      legal_text="${legal_text#*\"dependencies\"}"
      legal_text="${legal_text#*\{}"
      legal_text="${legal_text%%\}*}"
      ;;
  esac
  while [ "$legal_ok" = 0 ]; do
    case "$legal_text" in *'"'*) ;; *) break ;; esac
    legal_text="${legal_text#*\"}"
    legal_name="${legal_text%%\"*}"
    legal_text="${legal_text#*\"}"
    legal_text="${legal_text#*\"}"
    legal_text="${legal_text#*\"}"
    case "$legal_name" in "" | *..* | /*) legal_ok=1; break ;; esac
    if [ ! -f "$2/$legal_name/package.json" ] && { [ -z "${3:-}" ] || [ ! -f "$3/$legal_name/package.json" ]; }; then
      legal_ok=1
      legal_missing="$legal_name"
      break
    fi
  done
  unset legal_text legal_l legal_name
  if [ "$legal_ok" = 0 ]; then
    unset legal_ok
    return 0
  fi
  unset legal_ok
  return 1
}

legal_cli_refusal() {
  LEGAL_CLI_REFUSAL=""
  # Outside native Windows a backslash is a character of a file name, and Node.js refuses to start an ES module, as this
  # program is, from a path that holds one: it turns the path into a URL, where the backslash is written %5C, and stops
  # with ERR_INVALID_MODULE_SPECIFIER before the program's first line. So such a path is refused here in one sentence,
  # never handed to node. Native Windows is told apart by `pwd -W`, as the callers do; there the folder node is handed
  # is the Windows form `pwd -W` prints, and a backslash is a separator.
  case "$LEGAL_CLI_NODE_DIR" in
    *\\*)
      if ! (cd / && pwd -W) >/dev/null 2>&1; then
        LEGAL_CLI_REFUSAL="legal-scan: the path of this plugin's program, $LEGAL_CLI_DIR, has a backslash (\\) in it. Outside Windows Node.js does not start this program from a path that holds a backslash (it stops with ERR_INVALID_MODULE_SPECIFIER), so nothing was run. The plugin runs only from a folder whose path has no backslash."
        return 0
      fi
      ;;
  esac
  # An installed plugin's packages are installed by Claude Code from npm-shrinkwrap.json when it installs the plugin; the
  # plugin still loads where that failed (no npm on PATH, no network at that moment), and the program would then stop
  # with a Node stack. Every package its package.json names must be installed where Node will find it: in its own
  # node_modules, or, where npm installed the package into another folder's node_modules (a local `npm install`, npx),
  # beside it in that node_modules (legal_modules_above), which is where npm puts the packages it does not need to nest.
  # A plugin in Claude Code's cache is never in a node_modules folder, so there every package must be in its own
  # node_modules: a failed install (no node_modules) or one that stopped part way (an empty or partial one) is refused,
  # never run on packages from a folder above.
  if [ "$LEGAL_CLI_DIR" = "$LEGAL_PLUGIN_ROOT" ]; then
    legal_modules_above "$LEGAL_CLI_DIR"
    if [ ! -d "$LEGAL_CLI_DIR/node_modules" ] && [ -z "$legal_above" ]; then
      LEGAL_CLI_REFUSAL="legal-scan: this plugin's packages are not installed ($LEGAL_CLI_DIR/node_modules is missing). Claude Code installs them with npm when it installs the plugin, which needs npm on PATH and the network at that moment. Run claude plugin update for this plugin, which retries that install, or reinstall it."
    elif ! legal_dependencies_in "$LEGAL_CLI_DIR" "$LEGAL_CLI_DIR/node_modules" "$legal_above"; then
      if [ ! -d "$LEGAL_CLI_DIR/node_modules" ]; then
        LEGAL_CLI_REFUSAL="legal-scan: this plugin's packages are not installed ($LEGAL_CLI_DIR/node_modules is missing). Claude Code installs them with npm when it installs the plugin, which needs npm on PATH and the network at that moment. Run claude plugin update for this plugin, which retries that install, or reinstall it."
      else
        if [ -n "$legal_missing" ]; then legal_missing="$LEGAL_CLI_DIR/node_modules holds no $legal_missing"; else legal_missing="$LEGAL_CLI_DIR/package.json names no packages this launcher can check"; fi
        LEGAL_CLI_REFUSAL="legal-scan: this plugin's packages are not installed in full ($legal_missing), so nothing was run. Claude Code installs them with npm when it installs the plugin. To install them as pinned, run npm ci --ignore-scripts --install-strategy=hoisted in the plugin's folder, $LEGAL_CLI_DIR (npm's linked layout, which an npmrc's install-strategy=linked chooses, leaves out packages ajv needs)."
      fi
    fi
    unset legal_missing legal_above
    if [ -n "$LEGAL_CLI_REFUSAL" ]; then return 0; fi
  fi
  legal_version_of "$LEGAL_PLUGIN_ROOT/.claude-plugin/plugin.json"
  legal_pv="$legal_v"
  legal_version_of "$LEGAL_CLI_DIR/package.json"
  if [ -z "$legal_pv" ] || [ -z "$legal_v" ] || [ "$legal_pv" != "$legal_v" ]; then
    LEGAL_CLI_REFUSAL="legal-scan: this plugin is version ${legal_pv:-(none named in its .claude-plugin/plugin.json)} and the program it runs ($LEGAL_CLI_DIR) is version ${legal_v:-(none named in its package.json)}. The two are released together and must be the same version, so nothing was run. Reinstall the plugin, or in a source checkout make the two version fields agree."
  fi
  unset legal_pv legal_v
  return 0
}

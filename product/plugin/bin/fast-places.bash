# fast-places.bash: GENERATED from the built TypeScript (npm run gen:fast-places); never edit by hand.
# test:hook-prefilter fails where this file differs from a fresh generation (npm run gen:fast-places writes it).
# Read by bin/legal-hook's pre-filter (legal_fast_read).
# The tools the pre-filter serves: hook.ts SEAT_READ_TOOLS, the tools of guard-key-read.
legal_fp_tools=('Read' 'Grep' 'Glob')
# The run's marker under the project (hook.ts runPaths, ACTIVE_RUN_MARKER) and a project's .legal folder.
legal_fp_marker='.legal/launch/active-run.json'
legal_fp_legal='.legal'
# The names hook.ts guardTargetMayBe treats as guarded (GUARDED_NAMES).
legal_fp_names=('legal-scan' '.legal' 'wolfboy-redaction-key')
# The state folder (start-record.ts userStateDir, accountStateDir): <XDG_STATE_HOME>/legal-scan, or <home>/<one of these>/legal-scan.
legal_fp_state_env='XDG_STATE_HOME'
legal_fp_app='legal-scan'
legal_fp_below=('.local/state' 'Library/Application Support')
# The redaction key's file in the state folder, and its spare folder in the temporary folder (+ -<uid>).
legal_fp_key='redaction-key'
legal_fp_spare='wolfboy-redaction-key'
# Node's os.tmpdir() on POSIX: the first of these that is set and not empty, else /tmp.
legal_fp_tmp_envs=('TMPDIR' 'TMP' 'TEMP')
legal_fp_tmp_default='/tmp'

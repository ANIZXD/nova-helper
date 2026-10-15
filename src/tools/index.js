"use strict";

/**
 * Loads every built-in tool into the registry. Add a new capability by dropping
 * a module here that exports a `tools` array (or an array of tool objects).
 */

const registry = require("./registry");

let loaded = false;

function toArray(mod) {
  if (Array.isArray(mod)) return mod;
  if (mod && Array.isArray(mod.tools)) return mod.tools;
  return [];
}

function loadTools() {
  if (loaded) return registry;
  loaded = true;

  const modules = [
    require("./system"), // open_app, open_url, open_folder, search_web, run_command
    require("./keyboard"), // type_text, send_keys, press_key
    require("./clipboard"), // clipboard_set, clipboard_get
    require("./volume"), // volume_get/set/up/down/mute (Core Audio)
    require("./media"), // media_play_pause/next/prev/stop
    require("./window"), // list_windows, focus_window, window_state
    require("./system_extra"), // screenshot, notify, system_info, get_time, wait, lock_pc, sleep_pc
    require("./files"), // read_file, write_file, list_dir, make_dir, move/copy/delete
    require("./processes"), // list_processes, kill_process
    require("./messaging"), // send_message
    require("./mouse"), // mouse_move, mouse_click, mouse_scroll, mouse_pos, mouse_drag
    require("./agent"), // spawn_opencode, spawn_claude, run_in_terminal, dev_task
  ];
  for (const m of modules) registry.registerAll(toArray(m));

  return registry;
}

module.exports = { loadTools, registry };

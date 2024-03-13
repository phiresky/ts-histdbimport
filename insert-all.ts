#!/usr/bin/env node
import Sqlite from "better-sqlite3"
import { readFileSync } from "fs"
import { hostname } from "os"
import { join } from "path"

const homeDir = process.env.HOME
if (!homeDir) throw Error("no home dir")

const hostName = process.env.host || hostname()

// don't know these
const sessionNum = "-1"
const returnValue = "-1"
const runDir = join(homeDir, "unknown")
const DEFAULT_DATE = "0"
const DEFAULT_DURATION = "0"

const databaseFile =
	process.env.database || join(homeDir, ".histdb/zsh-history.db")

const historyFile =
	process.env.history_file ||
	process.env.HISTFILE ||
	join(homeDir, ".zsh_history")

type Entry = {
	started: string
	duration: string
	command: string
}
interface FullEntry extends Entry {
	session: string
	returnValue: string
	host: string
	dir: string
}
async function* readEntries() {
	// read the whole history file from disk and split it on every newline that
	// isn't escaped (preceded by a backslash)
	const history = readFileSync(historyFile, { encoding: "utf8" }).split(
		/(?<!\\)\n/,
	)

	let line = 0
	for await (const entry of history) {
		// increase the line count by the number of newlines that entry
		// contains
		line += entry.split("\n").length

		// if a whole history entry is empty just skip it
		//
		// I don't know if this could normally happen  in a history file since
		// I don't think zsh ever adds empty lines to history. The reason this
		// was added was because .split adds an empty entry to the end of the
		// array
		if (entry == "") {
			continue
		}

		const history_entry_regex = /^(: (?<started>\d+):(?<duration>\d+);)?(?<command>[\s\S]*)$/
		const result = history_entry_regex.exec(entry)
		// regex didn't match anything
		if (result == null) {
			console.log(result)

			throw Error(
				`no history syntax and no command on line ${line} in ${historyFile}: \n"${entry}"`,
			)
		}

		if (result.groups) {
			// add default values for started and duration if they are missing
			const { started = DEFAULT_DATE, duration = DEFAULT_DURATION, command } = result.groups;
			yield { started, duration, command } as Entry;
		}
	}

}
async function readHistory() {
	console.log(`importing history from "${historyFile} into "${databaseFile}"`)
	const db = new Sqlite(databaseFile) //, { verbose: console.log })
	db.exec("pragma foreign_keys = off")
	db.prepare("insert into places (host,dir) values (?,?)").run(
		hostName,
		runDir,
	)

	const commandInsert = db.prepare(
		"insert into commands (argv) values (@command)",
	)
	const historyInsert = db.prepare(`INSERT INTO history
        (session, command_id, place_id, exit_status, start_time, duration)
        SELECT @session, commands.rowid, places.rowid, @returnValue, @started, @duration
        FROM commands, places
        WHERE commands.argv = @command AND places.host = @host AND places.dir = @dir`)

	console.time("took")
	db.exec("BEGIN")
	let count = 0
	for await (const entry of readEntries()) {
		const fullEntry: FullEntry = {
			...entry,
			session: sessionNum,
			returnValue,
			dir: runDir,
			host: hostName,
		}
		commandInsert.run(fullEntry)
		historyInsert.run(fullEntry)
		count++
	}
	db.exec("COMMIT")
	console.timeEnd("took")
	console.log(`inserted ${count} history entries`)
}

readHistory()

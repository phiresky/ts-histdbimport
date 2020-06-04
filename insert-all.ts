#!/usr/bin/env node
import Sqlite from "better-sqlite3"
import { createReadStream } from "fs"
import { hostname } from "os"
import { join } from "path"
import { createInterface } from "readline"

const homeDir = process.env.HOME
if (!homeDir) throw Error("no home dir")

const hostName = process.env.host || hostname()

// don't know these
const sessionNum = "0"
const returnValue = "0"
const runDir = join(homeDir, "unknown")

const databaseFile =
	process.env.database || join(homeDir, ".histdb/zsh-history.db")
const historyFile = process.env.history_file || join(homeDir, ".zsh_history")

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
	const history = createInterface({
		input: createReadStream(historyFile),
	})

	let entry = ""
	for await (const line of history) {
		entry += line
		if (entry[entry.length - 1] == "\\") {
			entry = entry.slice(0, -1) + "\n"
		} else {
			yield entry
			entry = ""
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

	db.exec("BEGIN")
	for await (const entryStr of readEntries()) {
		const result = /^: (?<started>\d+):(?<duration>\d+);(?<command>[\s\S]*)$/.exec(
			entryStr,
		)
		if (!result) throw Error(`invalid history syntax: ${entryStr}`)
		const entryE = result.groups as Entry
		const fullEntry: FullEntry = {
			...entryE,
			session: sessionNum,
			returnValue,
			dir: runDir,
			host: hostName,
		}
		commandInsert.run(fullEntry)
		historyInsert.run(fullEntry)
	}
	db.exec("COMMIT")
}

readHistory()

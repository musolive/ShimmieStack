//
// TODO: encapsulate the underlying database elsewhere
//
import pg from 'pg';
const { Client } = pg;
import { Event, EventBase } from './event';

export interface EventConfig {
    connectionString: string;
}

export default function Eventbase(config: EventConfig): EventBase {
    if (!config.connectionString) {
        throw new Error('Missing DATABASE_URL environment variable.');
    } else {
        console.info('Eventbase connection string: ', config.connectionString);
    }

    const connection = new Client({
        connectionString: config.connectionString,
    });

    // called during start up to first connect to the database
    // TODO: retry to solve docker start up timing issue
    const init = async () => {
        await connection.connect();
        createTables();
    };

    const shutdown = async () => {
        await connection.end();
    };

    const addEvent = (event: Event) => {
        const query =
            'INSERT into eventlist(StreamId, Data, Type, Meta) VALUES($1, $2, $3, $4) RETURNING SequenceNum, streamId, logdate, type';
        const values: string[] = [
            event.streamId,
            JSON.stringify(event.data),
            event.type,
            JSON.stringify(event.meta),
        ];
        return runQuery(query, values);
    };

    // Get all events in the correct squence for replay
    const getAllEventsInOrder = () => {
        const query = 'SELECT * FROM eventlist ORDER BY SequenceNum';
        return runQuery(query);
    };

    const reset = async () => {
        await dropTables();
        await createTables();
    };

    const runQuery = async (
        query: string,
        values: string[] | undefined = undefined
    ) => {
        try {
            if (values) {
                return (await connection.query(query, values)).rows;
            } else {
                return (await connection.query(query)).rows;
            }
        } catch (err: any) {
            console.error(`Query error <${query}> [${values}]: ${err.message}`);
            throw err;
        }
    };

    //
    //  Create the tables required for the event store.
    //
    const createTables = async () => {
        const queryString = `
        CREATE TABLE IF NOT EXISTS eventlist
        (
            SequenceNum bigserial NOT NULL,
            StreamId text NOT NULL,
            Data jsonb NOT NULL,
            Type text NOT NULL,
            Meta jsonb NOT NULL,
            LogDate timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (SequenceNum)
        );`;

        return runQuery(queryString);
    };

    const dropTables = () => {
        const query = 'DROP TABLE IF EXISTS eventlist';
        try {
            return runQuery(query);
        } catch (err: any) {
            throw new Error(`Error dropping database tables: ${err.message}`);
        }
    };

    // filter out system tables
    // const showTables = () => {
    //     const query = `
    //         SELECT * FROM pg_catalog.pg_tables
    //         WHERE schemaname != 'pg_catalog' AND schemaname != 'information_schema';`;
    //     return runQuery(query);
    // };

    return {
        getAllEventsInOrder,
        addEvent,
        reset,
        init,
        shutdown,
    };
}

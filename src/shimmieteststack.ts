import { jest } from '@jest/globals'
import cookieParser from 'cookie-parser'
import express, { Router } from 'express'
import supertest from 'supertest'

import Eventbase from './eventbase-memory'
import PiiBase from './piibase-memory'
import ShimmieStack, { StackType } from './index'
import { authorizeApi, noAuthorization } from './authorizers'

/** Some extra convenience functions for ease testing */

// A record<string, any> with the Auth key autocomplete/type defined.
export type TestRequestHeaders = Record<string, any> & {
    Authorization: string,
}

// A base set of inputs for a test request
export interface TestRequestParams {
    path: string,
    headers?: TestRequestHeaders,
    expectedResponseCode?: number
}

// The above test request, but with a body. If T is provided, the body is typed to it.
export type TestRequestWithBodyParams<T = any> = TestRequestParams & {
    body?: T,
}

interface ShimmieTestStackType extends StackType {
    mountTest: (router: Router, mountpoint?: string) => void
    testGet: (
        params: TestRequestParams,
    ) => Promise<supertest.Response>
    testPost: (
        params: TestRequestWithBodyParams,
    ) => Promise<supertest.Response>
    testPut: (
        params: TestRequestWithBodyParams,
    ) => Promise<supertest.Response>
    testDelete: (
        params: TestRequestParams,
    ) => Promise<supertest.Response>
    use: (a: any) => any
}

// allow indexed function lookup by name
type SuperTester = supertest.SuperTest<supertest.Test> & Record<string, any>

export default function ShimmieTestStack(
    defaultAuthHeaderValue?: string,
    usePiiBase: boolean = false,
): ShimmieTestStackType {
    const authHeaderValue = defaultAuthHeaderValue
    const app = express()
    app.use(express.json())
    app.use(cookieParser())

    const prepareRequest =
        (method: string) =>
            (path: string, headers?: Record<string, string>, withAuth = true): supertest.Test => {
                const req: supertest.Test = (supertest(app) as SuperTester)[method](path)

                if (authHeaderValue && withAuth) {
                    req.set('\'Authorization\'', `Bearer ${authHeaderValue}`)
                }

                if (headers) {
                    Object.entries(headers).map((header) =>
                        req.set(header[0], header[1]),
                    )
                }

                return req
            }

    const methods = {
        post: prepareRequest('post'),
        get: prepareRequest('get'),
        put: prepareRequest('put'),
        delete: prepareRequest('delete'),
    }

    /** the test stack usese the in-memory event store */
    const memoryBase = Eventbase()

    /** the test stack usese the in-memory pii store */
    const piiBase = usePiiBase ? PiiBase() : undefined

    /** our inner actal shimmie stack that we control access to for tests */
    const testStack = ShimmieStack(
        {
            ServerPort: 9999 /* ignored because the express server is never started */,
            enforceAuthorization: false
        },
        memoryBase,
        authorizeApi(noAuthorization), // authorize admin apis with no auth for the test
        piiBase
    )

    // Mount al the test processors at the root for ease of local testing.
    const mountTest = (router: Router, mountpoint: string = '/') => {
        app.use(mountpoint, router)
    }

    /** Get helper that uses supertest to hook into the express route to make the actual call */
    const testGet = async (
        {
            path,
            headers,
            expectedResponseCode,
        }: TestRequestParams
    ): Promise<supertest.Response> => {
        return methods.get(path, headers).expect(expectedResponseCode ?? 200).send()
    }

    /** Post helper that uses supertest to hook into the express route to make the actual call */
    const testPost = async (
        {
            path,
            headers,
            expectedResponseCode,
            body,
        }: TestRequestWithBodyParams
    ): Promise<supertest.Response> => {
        return methods.post(path, headers).expect(expectedResponseCode ?? 200).send(body ?? {})
    }

    /** Put helper that uses supertest to hook into the express route to make the actual call */
    const testPut = async (
        {
            path,
            headers,
            expectedResponseCode,
            body,
        }: TestRequestWithBodyParams
    ): Promise<supertest.Response> => {
        return methods.put(path, headers).expect(expectedResponseCode ?? 200).send(body ?? {})
    }

    /** Delete helper that uses supertest to hook into the express route to make the actual call */
    const testDelete = async (
        {
            path,
            headers,
            expectedResponseCode,
        }: TestRequestParams
    ): Promise<supertest.Response> => {
        return methods.delete(path, headers).expect(expectedResponseCode ?? 200).send()
    }

    // Allow passthrough to the actal function, but also let testers count calls
    jest.spyOn(testStack, 'recordEvent')

    // the actual shimmie stack, plus our extras. User overrides the one in the underlying
    // ShimmieStack
    return {
        ...testStack,
        mountTest,
        testGet,
        testPost,
        testPut,
        testDelete,
        use: (a: any) => app.use(a),
    }
}

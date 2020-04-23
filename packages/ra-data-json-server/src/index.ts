import { stringify } from 'query-string';
import { fetchUtils, DataProvider } from 'ra-core';

/**
 * Maps react-admin queries to a json-server powered REST API
 *
 * @see https://github.com/typicode/json-server
 *
 * @example
 *
 * getList          => GET http://my.api.url/posts?_sort=title&_order=ASC&_start=0&_end=24
 * getOne           => GET http://my.api.url/posts/123
 * getManyReference => GET http://my.api.url/posts?author_id=345
 * getMany          => GET http://my.api.url/posts/123, GET http://my.api.url/posts/456, GET http://my.api.url/posts/789
 * create           => POST http://my.api.url/posts/123
 * update           => PUT http://my.api.url/posts/123
 * updateMany       => PUT http://my.api.url/posts/123, PUT http://my.api.url/posts/456, PUT http://my.api.url/posts/789
 * delete           => DELETE http://my.api.url/posts/123
 *
 * @example
 *
 * import React from 'react';
 * import { Admin, Resource } from 'react-admin';
 * import jsonServerProvider from 'ra-data-json-server';
 *
 * import { PostList } from './posts';
 *
 * const App = () => (
 *     <Admin dataProvider={jsonServerProvider('http://jsonplaceholder.typicode.com')}>
 *         <Resource name="posts" list={PostList} />
 *     </Admin>
 * );
 *
 * export default App;
 */

// Id function is necessary, as React Admin always expects a property named "id"
function idFuncSingle(json: any) {
    json.id = json.Id;
    return json;
}

function idFunc(json: any) {
    if (Array.isArray(json)) return json.map(item => idFuncSingle(item));
    else return idFuncSingle(json);
}

function getOdataFilter(filterObj: any) {
    let filterString = '';

    for (const filterKey in filterObj) {
        let value = filterObj[filterKey];
        if (!Array.isArray(value)) value = [value];
        else value = value.sort();

        if (filterString) filterString += ' or ';

        filterString += `${filterKey} in (${value
            .map(val => (isNaN(val) ? `'${val}'` : val))
            .join(', ')})`;

        // filterString = value.reduce((prev: any, val: any) => {
        //     if (prev) prev += ' or ';

        //     if (isNaN(val)) val = `'${val}'`;
        //     prev += `${filterKey} eq ${val}`;

        //     return prev;
        // }, filterString);
    }

    return `$filter=${filterString}`;
}

export default (apiUrl, httpClient = fetchUtils.fetchJson): DataProvider => ({
    getList: (resource, params) => {
        const { page, perPage } = params.pagination;
        const { field, order } = params.sort;
        const query = {
            ...fetchUtils.flattenObject(params.filter),
            _sort: field,
            _order: order,
            _start: (page - 1) * perPage,
            _end: page * perPage,
        };
        const url = `${apiUrl}/${resource}?${stringify(query)}`;

        return httpClient(url).then(({ headers, json }) => {
            const { value } = json;
            return {
                data: idFunc(value),
                total: value.length,
            };
        });
    },

    getOne: (resource, params) =>
        httpClient(`${apiUrl}/${resource}/${params.id}`).then(({ json }) => ({
            data: idFunc(json),
        })),

    getMany: (resource, params) => {
        const filterObj = {
            Id: params.ids,
        };
        const odataFilter = getOdataFilter(filterObj);

        const url = `${apiUrl}/${resource}?${odataFilter}`;
        return httpClient(url).then(({ json }) => ({
            data: idFunc(json.value),
        }));
    },

    getManyReference: (resource, params) => {
        // const { page, perPage } = params.pagination;
        // const { field, order } = params.sort;
        // const query = {
        //     ...fetchUtils.flattenObject(params.filter),
        //     [params.target]: params.id,
        //     _sort: field,
        //     _order: order,
        //     _start: (page - 1) * perPage,
        //     _end: page * perPage,
        // };
        const filterObj = {};
        const { target, id } = params;
        filterObj[target] = id;

        const url = `${apiUrl}/${resource}?${getOdataFilter(filterObj)}`;

        return httpClient(url).then(({ headers, json }) => {
            const { value } = json;
            return {
                data: idFunc(value),
                total: value.length,
            };
        });
    },

    update: (resource, params) => {
        // delete "id" from payload, because odata does not like this
        delete params.data.id;

        return httpClient(`${apiUrl}/${resource}/${params.id}`, {
            method: 'PUT',
            body: JSON.stringify(params.data),
            // unfortunately odata doesn't give us a response payload here
        }).then(({ json }) => ({ data: idFunc(params.data) }));
    },

    // json-server doesn't handle filters on UPDATE route, so we fallback to calling UPDATE n times instead
    updateMany: (resource, params) =>
        Promise.all(
            params.ids.map(id =>
                httpClient(`${apiUrl}/${resource}/${id}`, {
                    method: 'PUT',
                    body: JSON.stringify(params.data),
                })
            )
            // odata needs "id" as uppercase property
        ).then(responses => ({ data: responses.map(({ json }) => json.Id) })),

    create: (resource, params) =>
        httpClient(`${apiUrl}/${resource}`, {
            method: 'POST',
            body: JSON.stringify(params.data),
        }).then(({ json }) => ({
            data: idFunc(json),
        })),

    delete: (resource, params) =>
        httpClient(`${apiUrl}/${resource}/${params.id}`, {
            method: 'DELETE',
        }).then(() => ({ data: idFunc(params) })),

    // json-server doesn't handle filters on DELETE route, so we fallback to calling DELETE n times instead
    deleteMany: (resource, params) =>
        Promise.all(
            params.ids.map(id =>
                httpClient(`${apiUrl}/${resource}/${id}`, {
                    method: 'DELETE',
                })
            )
            // odata needs "id" as uppercase property
            // odata service doesn't deliver deleted items, therefore we assume all of them werde deleted
        ).then(() => ({ data: idFunc(params.ids) })),
});

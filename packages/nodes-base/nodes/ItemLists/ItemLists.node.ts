import { IExecuteFunctions } from 'n8n-core';

import {
	IDataObject,
	INode,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import { get, isEmpty, isEqual, isObject, lt, merge, pick, reduce, set, unset } from 'lodash';

const { NodeVM } = require('vm2');

export class ItemLists implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Item Lists',
		name: 'itemLists',
		icon: 'file:itemLists.svg',
		group: ['input'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Helper for working with lists of items and transforming arrays',
		defaults: {
			name: 'Item Lists',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'hidden',
				options: [
					{
						name: 'Item List',
						value: 'itemList',
					},
				],
				default: 'itemList',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Aggregate Items',
						value: 'aggregateItems',
						description: 'Combine fields into a single new item',
						action: 'Combine fields into a single new item',
					},
					{
						name: 'Limit',
						value: 'limit',
						description: 'Remove items if there are too many',
						action: 'Remove items if there are too many',
					},
					{
						name: 'Remove Duplicates',
						value: 'removeDuplicates',
						description: 'Remove extra items that are similar',
						action: 'Remove extra items that are similar',
					},
					{
						name: 'Sort',
						value: 'sort',
						description: 'Change the item order',
						action: 'Change the item order',
					},
					{
						name: 'Split Out Items',
						value: 'splitOutItems',
						description: 'Turn a list inside item(s) into separate items',
						action: 'Turn a list inside item(s) into separate items',
					},
				],
				default: 'splitOutItems',
			},
			// Split out items - Fields

			{
				displayName: 'Field To Split Out',
				name: 'fieldToSplitOut',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['itemList'],
						operation: ['splitOutItems'],
					},
				},
				description: 'The name of the input field to break out into separate items',
			},
			{
				displayName: 'Include',
				name: 'include',
				type: 'options',
				options: [
					{
						name: 'No Other Fields',
						value: 'noOtherFields',
					},
					{
						name: 'All Other Fields',
						value: 'allOtherFields',
					},
					{
						name: 'Selected Other Fields',
						value: 'selectedOtherFields',
					},
				],
				default: 'noOtherFields',
				description: 'Whether to copy any other fields into the new items',
				displayOptions: {
					show: {
						resource: ['itemList'],
						operation: ['splitOutItems'],
					},
				},
			},
			{
				displayName: 'Fields To Include',
				name: 'fieldsToInclude',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				placeholder: 'Add Field To Include',
				default: {},
				displayOptions: {
					show: {
						resource: ['itemList'],
						operation: ['splitOutItems'],
						include: ['selectedOtherFields'],
					},
				},
				options: [
					{
						displayName: '',
						name: 'fields',
						values: [
							{
								displayName: 'Field Name',
								name: 'fieldName',
								type: 'string',
								default: '',
								description: 'A field in the input items to aggregate together',
								// eslint-disable-next-line n8n-nodes-base/node-param-placeholder-miscased-id
								placeholder: 'e.g. id',
								hint: ' Enter the field name as text',
							},
						],
					},
				],
			},
			// Aggregate Items
			{
				displayName: 'Aggregate',
				name: 'aggregate',
				type: 'options',
				default: 'aggregateIndividualFields',
				options: [
					{
						name: 'Individual Fields',
						value: 'aggregateIndividualFields',
					},
					{
						name: 'All Item Data (Into a Single List)',
						value: 'aggregateAllItemData',
					},
				],
				displayOptions: {
					show: {
						resource: ['itemList'],
						operation: ['aggregateItems'],
					},
				},
			},
			// Aggregate Individual Fields
			{
				displayName: 'Fields To Aggregate',
				name: 'fieldsToAggregate',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				placeholder: 'Add Field To Aggregate',
				default: { fieldToAggregate: [{ fieldToAggregate: '', renameField: false }] },
				displayOptions: {
					show: {
						resource: ['itemList'],
						operation: ['aggregateItems'],
						aggregate: ['aggregateIndividualFields'],
					},
				},
				options: [
					{
						displayName: '',
						name: 'fieldToAggregate',
						values: [
							{
								displayName: 'Input Field Name',
								name: 'fieldToAggregate',
								type: 'string',
								default: '',
								description: 'The name of a field in the input items to aggregate together',
								// eslint-disable-next-line n8n-nodes-base/node-param-placeholder-miscased-id
								placeholder: 'e.g. id',
								hint: ' Enter the field name as text',
							},
							{
								displayName: 'Rename Field',
								name: 'renameField',
								type: 'boolean',
								default: false,
								description: 'Whether to give the field a different name in the output',
							},
							{
								displayName: 'Output Field Name',
								name: 'outputFieldName',
								displayOptions: {
									show: {
										renameField: [true],
									},
								},
								type: 'string',
								default: '',
								description:
									'The name of the field to put the aggregated data in. Leave blank to use the input field name.',
							},
						],
					},
				],
			},
			// Aggregate All Item Data
			{
				displayName: 'Put Output in Field',
				name: 'destinationFieldName',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['itemList'],
						operation: ['aggregateItems'],
						aggregate: ['aggregateAllItemData'],
					},
				},
				default: 'data',
				description: 'The name of the output field to put the data in',
			},
			{
				displayName: 'Include',
				name: 'include',
				type: 'options',
				default: 'allFields',
				options: [
					{
						name: 'All Fields',
						value: 'allFields',
					},
					{
						name: 'Specified Fields',
						value: 'specifiedFields',
					},
					{
						name: 'All Fields Except',
						value: 'allFieldsExcept',
					},
				],
				displayOptions: {
					show: {
						resource: ['itemList'],
						operation: ['aggregateItems'],
						aggregate: ['aggregateAllItemData'],
					},
				},
			},
			{
				displayName: 'Fields To Exclude',
				name: 'fieldsToExclude',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				placeholder: 'Add Field To Exclude',
				default: {},
				options: [
					{
						displayName: '',
						name: 'fields',
						values: [
							{
								displayName: 'Field Name',
								name: 'fieldName',
								type: 'string',
								default: '',
								description: 'A field in the input to exclude from the object in output array',
								// eslint-disable-next-line n8n-nodes-base/node-param-placeholder-miscased-id
								placeholder: 'e.g. id',
								hint: ' Enter the field name as text',
							},
						],
					},
				],
				displayOptions: {
					show: {
						resource: ['itemList'],
						operation: ['aggregateItems'],
						aggregate: ['aggregateAllItemData'],
						include: ['allFieldsExcept'],
					},
				},
			},
			{
				displayName: 'Fields To Include',
				name: 'fieldsToInclude',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				placeholder: 'Add Field To Include',
				default: {},
				options: [
					{
						displayName: '',
						name: 'fields',
						values: [
							{
								displayName: 'Field Name',
								name: 'fieldName',
								type: 'string',
								default: '',
								description: 'Specify fields that will be included in output array',
								// eslint-disable-next-line n8n-nodes-base/node-param-placeholder-miscased-id
								placeholder: 'e.g. id',
								hint: ' Enter the field name as text',
							},
						],
					},
				],
				displayOptions: {
					show: {
						resource: ['itemList'],
						operation: ['aggregateItems'],
						aggregate: ['aggregateAllItemData'],
						include: ['specifiedFields'],
					},
				},
			},
			// Remove duplicates - Fields
			{
				displayName: 'Compare',
				name: 'compare',
				type: 'options',
				options: [
					{
						name: 'All Fields',
						value: 'allFields',
					},
					{
						name: 'All Fields Except',
						value: 'allFieldsExcept',
					},
					{
						name: 'Selected Fields',
						value: 'selectedFields',
					},
				],
				default: 'allFields',
				description: 'The fields of the input items to compare to see if they are the same',
				displayOptions: {
					show: {
						resource: ['itemList'],
						operation: ['removeDuplicates'],
					},
				},
			},
			{
				displayName: 'Fields To Exclude',
				name: 'fieldsToExclude',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				placeholder: 'Add Field To Exclude',
				default: {},
				displayOptions: {
					show: {
						resource: ['itemList'],
						operation: ['removeDuplicates'],
						compare: ['allFieldsExcept'],
					},
				},
				options: [
					{
						displayName: '',
						name: 'fields',
						values: [
							{
								displayName: 'Field Name',
								name: 'fieldName',
								type: 'string',
								default: '',
								description: 'A field in the input to exclude from the comparison',
								// eslint-disable-next-line n8n-nodes-base/node-param-placeholder-miscased-id
								placeholder: 'e.g. id',
								hint: ' Enter the field name as text',
							},
						],
					},
				],
			},
			{
				displayName: 'Fields To Compare',
				name: 'fieldsToCompare',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				placeholder: 'Add Field To Compare',
				default: {},
				displayOptions: {
					show: {
						resource: ['itemList'],
						operation: ['removeDuplicates'],
						compare: ['selectedFields'],
					},
				},
				options: [
					{
						displayName: '',
						name: 'fields',
						values: [
							{
								displayName: 'Field Name',
								name: 'fieldName',
								type: 'string',
								default: '',
								description: 'A field in the input to add to the comparison',
								// eslint-disable-next-line n8n-nodes-base/node-param-placeholder-miscased-id
								placeholder: 'e.g. id',
								hint: ' Enter the field name as text',
							},
						],
					},
				],
			},
			// Sort - Fields
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				options: [
					{
						name: 'Simple',
						value: 'simple',
					},
					{
						name: 'Random',
						value: 'random',
					},
					{
						name: 'Code',
						value: 'code',
					},
				],
				default: 'simple',
				description: 'The fields of the input items to compare to see if they are the same',
				displayOptions: {
					show: {
						resource: ['itemList'],
						operation: ['sort'],
					},
				},
			},
			{
				displayName: 'Fields To Sort By',
				name: 'sortFieldsUi',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				placeholder: 'Add Field To Sort By',
				options: [
					{
						displayName: '',
						name: 'sortField',
						values: [
							{
								displayName: 'Field Name',
								name: 'fieldName',
								type: 'string',
								required: true,
								default: '',
								description: 'The field to sort by',
								// eslint-disable-next-line n8n-nodes-base/node-param-placeholder-miscased-id
								placeholder: 'e.g. id',
								hint: ' Enter the field name as text',
							},
							{
								displayName: 'Order',
								name: 'order',
								type: 'options',
								options: [
									{
										name: 'Ascending',
										value: 'ascending',
									},
									{
										name: 'Descending',
										value: 'descending',
									},
								],
								default: 'ascending',
								description: 'The order to sort by',
							},
						],
					},
				],
				default: {},
				description: 'The fields of the input items to compare to see if they are the same',
				displayOptions: {
					show: {
						resource: ['itemList'],
						operation: ['sort'],
						type: ['simple'],
					},
				},
			},
			{
				displayName: 'Code',
				name: 'code',
				type: 'string',
				typeOptions: {
					alwaysOpenEditWindow: true,
					editor: 'code',
					rows: 10,
				},
				default: `// The two items to compare are in the variables a and b
// Access the fields in a.json and b.json
// Return -1 if a should go before b
// Return 1 if b should go before a
// Return 0 if there's no difference

fieldName = 'myField';

if (a.json[fieldName] < b.json[fieldName]) {
		return -1;
}
if (a.json[fieldName] > b.json[fieldName]) {
		return 1;
}
return 0;`,
				description: 'Javascript code to determine the order of any two items',
				displayOptions: {
					show: {
						resource: ['itemList'],
						operation: ['sort'],
						type: ['code'],
					},
				},
			},
			// Limit - Fields
			{
				displayName: 'Max Items',
				name: 'maxItems',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: 1,
				description: 'If there are more items than this number, some are removed',
				displayOptions: {
					show: {
						resource: ['itemList'],
						operation: ['limit'],
					},
				},
			},
			{
				displayName: 'Keep',
				name: 'keep',
				type: 'options',
				options: [
					{
						name: 'First Items',
						value: 'firstItems',
					},
					{
						name: 'Last Items',
						value: 'lastItems',
					},
				],
				default: 'firstItems',
				description: 'When removing items, whether to keep the ones at the start or the ending',
				displayOptions: {
					show: {
						resource: ['itemList'],
						operation: ['limit'],
					},
				},
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['itemList'],
						operation: ['removeDuplicates'],
						compare: ['allFieldsExcept', 'selectedFields'],
					},
				},
				options: [
					{
						displayName: 'Remove Other Fields',
						name: 'removeOtherFields',
						type: 'boolean',
						default: false,
						description:
							'Whether to remove any fields that are not being compared. If disabled, will keep the values from the first of the duplicates.',
					},
					{
						displayName: 'Disable Dot Notation',
						name: 'disableDotNotation',
						type: 'boolean',
						default: false,
						description:
							'Whether to disallow referencing child fields using `parent.child` in the field name',
					},
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['itemList'],
						operation: ['sort'],
						type: ['simple'],
					},
				},
				options: [
					{
						displayName: 'Disable Dot Notation',
						name: 'disableDotNotation',
						type: 'boolean',
						default: false,
						description:
							'Whether to disallow referencing child fields using `parent.child` in the field name',
					},
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['itemList'],
						operation: ['splitOutItems', 'aggregateItems'],
					},
					hide: {
						aggregate: ['aggregateAllItemData'],
					},
				},
				options: [
					{
						displayName: 'Disable Dot Notation',
						name: 'disableDotNotation',
						type: 'boolean',
						displayOptions: {
							show: {
								'/operation': ['splitOutItems', 'aggregateItems'],
							},
						},
						default: false,
						description:
							'Whether to disallow referencing child fields using `parent.child` in the field name',
					},
					{
						displayName: 'Destination Field Name',
						name: 'destinationFieldName',
						type: 'string',
						displayOptions: {
							show: {
								'/operation': ['splitOutItems'],
							},
						},
						default: '',
						description: 'The field in the output under which to put the split field contents',
					},
					{
						displayName: 'Merge Lists',
						name: 'mergeLists',
						type: 'boolean',
						displayOptions: {
							show: {
								'/operation': ['aggregateItems'],
							},
						},
						default: false,
						description:
							'Whether to merge the output into a single flat list (rather than a list of lists), if the field to aggregate is a list',
					},
					{
						displayName: 'Keep Missing And Null Values',
						name: 'keepMissing',
						type: 'boolean',
						displayOptions: {
							show: {
								'/operation': ['aggregateItems'],
							},
						},
						default: false,
						description:
							'Whether to add a null entry to the aggregated list when there is a missing or null value',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const length = items.length;
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0);
		const operation = this.getNodeParameter('operation', 0);
		if (resource === 'itemList') {
			if (operation === 'splitOutItems') {
				for (let i = 0; i < length; i++) {
					const fieldToSplitOut = this.getNodeParameter('fieldToSplitOut', i) as string;
					const disableDotNotation = this.getNodeParameter(
						'options.disableDotNotation',
						0,
						false,
					) as boolean;
					const destinationFieldName = this.getNodeParameter(
						'options.destinationFieldName',
						i,
						'',
					) as string;
					const include = this.getNodeParameter('include', i) as string;

					let arrayToSplit;
					if (!disableDotNotation) {
						arrayToSplit = get(items[i].json, fieldToSplitOut);
					} else {
						arrayToSplit = items[i].json[fieldToSplitOut];
					}

					if (arrayToSplit === undefined) {
						if (fieldToSplitOut.includes('.') && disableDotNotation) {
							throw new NodeOperationError(
								this.getNode(),
								`Couldn't find the field '${fieldToSplitOut}' in the input data`,
								{
									description: `If you're trying to use a nested field, make sure you turn off 'disable dot notation' in the node options`,
								},
							);
						} else {
							throw new NodeOperationError(
								this.getNode(),
								`Couldn't find the field '${fieldToSplitOut}' in the input data`,
								{ itemIndex: i },
							);
						}
					}

					if (!Array.isArray(arrayToSplit)) {
						throw new NodeOperationError(
							this.getNode(),
							`The provided field '${fieldToSplitOut}' is not an array`,
							{ itemIndex: i },
						);
					} else {
						for (const element of arrayToSplit) {
							let newItem = {};

							if (include === 'selectedOtherFields') {
								const fieldsToInclude = (
									this.getNodeParameter('fieldsToInclude.fields', i, []) as [{ fieldName: string }]
								).map((field) => field.fieldName);

								if (!fieldsToInclude.length) {
									throw new NodeOperationError(this.getNode(), 'No fields specified', {
										description: 'Please add a field to include',
									});
								}

								newItem = {
									...fieldsToInclude.reduce((prev, field) => {
										if (field === fieldToSplitOut) {
											return prev;
										}
										let value;
										if (!disableDotNotation) {
											value = get(items[i].json, field);
										} else {
											value = items[i].json[field];
										}
										prev = { ...prev, [field]: value };
										return prev;
									}, {}),
								};
							} else if (include === 'allOtherFields') {
								const keys = Object.keys(items[i].json);

								newItem = {
									...keys.reduce((prev, field) => {
										let value;
										if (!disableDotNotation) {
											value = get(items[i].json, field);
										} else {
											value = items[i].json[field];
										}
										prev = { ...prev, [field]: value };
										return prev;
									}, {}),
								};

								unset(newItem, fieldToSplitOut);
							}

							if (
								typeof element === 'object' &&
								include === 'noOtherFields' &&
								destinationFieldName === ''
							) {
								newItem = { ...newItem, ...element };
							} else {
								newItem = {
									...newItem,
									[destinationFieldName || fieldToSplitOut]: element,
								};
							}

							returnData.push({
								json: newItem,
								pairedItem: {
									item: i,
								},
							});
						}
					}
				}

				return this.prepareOutputData(returnData);
			} else if (operation === 'aggregateItems') {
				const aggregate = this.getNodeParameter('aggregate', 0, '') as string;

				if (aggregate === 'aggregateIndividualFields') {
					const disableDotNotation = this.getNodeParameter(
						'options.disableDotNotation',
						0,
						false,
					) as boolean;
					const mergeLists = this.getNodeParameter('options.mergeLists', 0, false) as boolean;
					const fieldsToAggregate = this.getNodeParameter(
						'fieldsToAggregate.fieldToAggregate',
						0,
						[],
					) as [{ fieldToAggregate: string; renameField: boolean; outputFieldName: string }];
					const keepMissing = this.getNodeParameter('options.keepMissing', 0, false) as boolean;

					if (!fieldsToAggregate.length) {
						throw new NodeOperationError(this.getNode(), 'No fields specified', {
							description: 'Please add a field to aggregate',
						});
					}
					for (const { fieldToAggregate } of fieldsToAggregate) {
						let found = false;
						for (const item of items) {
							if (fieldToAggregate === '') {
								throw new NodeOperationError(this.getNode(), 'Field to aggregate is blank', {
									description: 'Please add a field to aggregate',
								});
							}
							if (!disableDotNotation) {
								if (get(item.json, fieldToAggregate) !== undefined) {
									found = true;
								}
							} else if (item.json.hasOwnProperty(fieldToAggregate)) {
								found = true;
							}
						}
						if (!found && disableDotNotation && fieldToAggregate.includes('.')) {
							throw new NodeOperationError(
								this.getNode(),
								`Couldn't find the field '${fieldToAggregate}' in the input data`,
								{
									description: `If you're trying to use a nested field, make sure you turn off 'disable dot notation' in the node options`,
								},
							);
						} else if (!found && !keepMissing) {
							throw new NodeOperationError(
								this.getNode(),
								`Couldn't find the field '${fieldToAggregate}' in the input data`,
							);
						}
					}

					const newItem: INodeExecutionData = {
						json: {},
						pairedItem: Array.from({ length }, (_, i) => i).map((index) => {
							return {
								item: index,
							};
						}),
					};

					const values: { [key: string]: any } = {};
					const outputFields: string[] = [];

					for (const { fieldToAggregate, outputFieldName, renameField } of fieldsToAggregate) {
						const field = renameField ? outputFieldName : fieldToAggregate;

						if (outputFields.includes(field)) {
							throw new NodeOperationError(
								this.getNode(),
								`The '${field}' output field is used more than once`,
								{ description: `Please make sure each output field name is unique` },
							);
						} else {
							outputFields.push(field);
						}

						const getFieldToAggregate = () =>
							!disableDotNotation && fieldToAggregate.includes('.')
								? fieldToAggregate.split('.').pop()
								: fieldToAggregate;

						const _outputFieldName = outputFieldName
							? outputFieldName
							: (getFieldToAggregate() as string);

						if (fieldToAggregate !== '') {
							values[_outputFieldName] = [];
							for (let i = 0; i < length; i++) {
								if (!disableDotNotation) {
									let value = get(items[i].json, fieldToAggregate);

									if (!keepMissing) {
										if (Array.isArray(value)) {
											value = value.filter((entry) => entry !== null);
										} else if (value === null || value === undefined) {
											continue;
										}
									}

									if (Array.isArray(value) && mergeLists) {
										values[_outputFieldName].push(...value);
									} else {
										values[_outputFieldName].push(value);
									}
								} else {
									let value = items[i].json[fieldToAggregate];

									if (!keepMissing) {
										if (Array.isArray(value)) {
											value = value.filter((entry) => entry !== null);
										} else if (value === null || value === undefined) {
											continue;
										}
									}

									if (Array.isArray(value) && mergeLists) {
										values[_outputFieldName].push(...value);
									} else {
										values[_outputFieldName].push(value);
									}
								}
							}
						}
					}

					for (const key of Object.keys(values)) {
						if (!disableDotNotation) {
							set(newItem.json, key, values[key]);
						} else {
							newItem.json[key] = values[key];
						}
					}

					returnData.push(newItem);

					return this.prepareOutputData(returnData);
				} else {
					let newItems: IDataObject[] = items.map((item) => item.json);
					const destinationFieldName = this.getNodeParameter('destinationFieldName', 0) as string;
					const fieldsToExclude = (
						this.getNodeParameter('fieldsToExclude.fields', 0, []) as IDataObject[]
					).map((entry) => entry.fieldName);
					const fieldsToInclude = (
						this.getNodeParameter('fieldsToInclude.fields', 0, []) as IDataObject[]
					).map((entry) => entry.fieldName);

					if (fieldsToExclude.length || fieldsToInclude.length) {
						newItems = newItems.reduce((acc, item) => {
							const newItem: IDataObject = {};
							let outputFields = Object.keys(item);

							if (fieldsToExclude.length) {
								outputFields = outputFields.filter((key) => !fieldsToExclude.includes(key));
							}
							if (fieldsToInclude.length) {
								outputFields = outputFields.filter((key) =>
									fieldsToInclude.length ? fieldsToInclude.includes(key) : true,
								);
							}

							outputFields.forEach((key) => {
								newItem[key] = item[key];
							});

							if (isEmpty(newItem)) {
								return acc;
							}
							return acc.concat([newItem]);
						}, [] as IDataObject[]);
					}

					const output: INodeExecutionData = { json: { [destinationFieldName]: newItems } };

					return this.prepareOutputData([output]);
				}
			} else if (operation === 'removeDuplicates') {
				const compare = this.getNodeParameter('compare', 0) as string;
				const disableDotNotation = this.getNodeParameter(
					'options.disableDotNotation',
					0,
					false,
				) as boolean;
				const removeOtherFields = this.getNodeParameter(
					'options.removeOtherFields',
					0,
					false,
				) as boolean;

				let keys = disableDotNotation
					? Object.keys(items[0].json)
					: Object.keys(flattenKeys(items[0].json));

				for (const item of items) {
					for (const key of disableDotNotation
						? Object.keys(item.json)
						: Object.keys(flattenKeys(item.json))) {
						if (!keys.includes(key)) {
							keys.push(key);
						}
					}
				}

				if (compare === 'allFieldsExcept') {
					const fieldsToExclude = (
						this.getNodeParameter('fieldsToExclude.fields', 0, []) as [{ fieldName: string }]
					).map((field) => field.fieldName);
					if (!fieldsToExclude.length) {
						throw new NodeOperationError(
							this.getNode(),
							'No fields specified. Please add a field to exclude from comparison',
						);
					}
					if (!disableDotNotation) {
						keys = Object.keys(flattenKeys(items[0].json));
					}
					keys = keys.filter((key) => !fieldsToExclude.includes(key));
				}
				if (compare === 'selectedFields') {
					const fieldsToCompare = (
						this.getNodeParameter('fieldsToCompare.fields', 0, []) as [{ fieldName: string }]
					).map((field) => field.fieldName);
					if (!fieldsToCompare.length) {
						throw new NodeOperationError(
							this.getNode(),
							'No fields specified. Please add a field to compare on',
						);
					}
					if (!disableDotNotation) {
						keys = Object.keys(flattenKeys(items[0].json));
					}
					keys = fieldsToCompare.map((key) => key.trim());
				}

				// This solution is O(nlogn)
				// add original index to the items
				const newItems = items.map(
					(item, index) =>
						({
							json: { ...item.json, __INDEX: index },
							pairedItem: { item: index },
						} as INodeExecutionData),
				);
				//sort items using the compare keys
				newItems.sort((a, b) => {
					let result = 0;

					for (const key of keys) {
						let equal;
						if (!disableDotNotation) {
							equal = isEqual(get(a.json, key), get(b.json, key));
						} else {
							equal = isEqual(a.json[key], b.json[key]);
						}
						if (!equal) {
							let lessThan;
							if (!disableDotNotation) {
								lessThan = lt(get(a.json, key), get(b.json, key));
							} else {
								lessThan = lt(a.json[key], b.json[key]);
							}
							result = lessThan ? -1 : 1;
							break;
						}
					}
					return result;
				});

				for (const key of keys) {
					let type: any = undefined;
					for (const item of newItems) {
						if (key === '') {
							throw new NodeOperationError(this.getNode(), `Name of field to compare is blank`);
						}
						const value = !disableDotNotation ? get(item.json, key) : item.json[key];
						if (value === undefined && disableDotNotation && key.includes('.')) {
							throw new NodeOperationError(
								this.getNode(),
								`'${key}' field is missing from some input items`,
								{
									description: `If you're trying to use a nested field, make sure you turn off 'disable dot notation' in the node options`,
								},
							);
						} else if (value === undefined) {
							throw new NodeOperationError(
								this.getNode(),
								`'${key}' field is missing from some input items`,
							);
						}
						if (type !== undefined && value !== undefined && type !== typeof value) {
							throw new NodeOperationError(this.getNode(), `'${key}' isn't always the same type`, {
								description: 'The type of this field varies between items',
							});
						} else {
							type = typeof value;
						}
					}
				}

				// collect the original indexes of items to be removed
				const removedIndexes: number[] = [];
				let temp = newItems[0];
				for (let index = 1; index < newItems.length; index++) {
					if (compareItems(newItems[index], temp, keys, disableDotNotation, this.getNode())) {
						removedIndexes.push(newItems[index].json.__INDEX as unknown as number);
					} else {
						temp = newItems[index];
					}
				}

				let data = items.filter((_, index) => !removedIndexes.includes(index));

				if (removeOtherFields) {
					data = data.map((item, index) => ({
						json: pick(item.json, ...keys),
						pairedItem: { item: index },
					}));
				}

				// return the filtered items
				return this.prepareOutputData(data);
			} else if (operation === 'sort') {
				let newItems = [...items];
				const type = this.getNodeParameter('type', 0) as string;
				const disableDotNotation = this.getNodeParameter(
					'options.disableDotNotation',
					0,
					false,
				) as boolean;

				if (type === 'random') {
					shuffleArray(newItems);
					return this.prepareOutputData(newItems);
				}

				if (type === 'simple') {
					const sortFieldsUi = this.getNodeParameter('sortFieldsUi', 0) as IDataObject;
					const sortFields = sortFieldsUi.sortField as Array<{
						fieldName: string;
						order: 'ascending' | 'descending';
					}>;

					if (!sortFields?.length) {
						throw new NodeOperationError(
							this.getNode(),
							'No sorting specified. Please add a field to sort by',
						);
					}

					for (const { fieldName } of sortFields) {
						let found = false;
						for (const item of items) {
							if (!disableDotNotation) {
								if (get(item.json, fieldName) !== undefined) {
									found = true;
								}
							} else if (item.json.hasOwnProperty(fieldName)) {
								found = true;
							}
						}
						if (!found && disableDotNotation && fieldName.includes('.')) {
							throw new NodeOperationError(
								this.getNode(),
								`Couldn't find the field '${fieldName}' in the input data`,
								{
									description: `If you're trying to use a nested field, make sure you turn off 'disable dot notation' in the node options`,
								},
							);
						} else if (!found) {
							throw new NodeOperationError(
								this.getNode(),
								`Couldn't find the field '${fieldName}' in the input data`,
							);
						}
					}

					const sortFieldsWithDirection = sortFields.map((field) => ({
						name: field.fieldName,
						dir: field.order === 'ascending' ? 1 : -1,
					}));

					newItems.sort((a, b) => {
						let result = 0;
						for (const field of sortFieldsWithDirection) {
							let equal;
							if (!disableDotNotation) {
								const _a =
									typeof get(a.json, field.name) === 'string'
										? (get(a.json, field.name) as string).toLowerCase()
										: get(a.json, field.name);
								const _b =
									typeof get(b.json, field.name) === 'string'
										? (get(b.json, field.name) as string).toLowerCase()
										: get(b.json, field.name);
								equal = isEqual(_a, _b);
							} else {
								const _a =
									typeof a.json[field.name] === 'string'
										? (a.json[field.name] as string).toLowerCase()
										: a.json[field.name];
								const _b =
									typeof b.json[field.name] === 'string'
										? (b.json[field.name] as string).toLowerCase()
										: b.json[field.name];
								equal = isEqual(_a, _b);
							}

							if (!equal) {
								let lessThan;
								if (!disableDotNotation) {
									const _a =
										typeof get(a.json, field.name) === 'string'
											? (get(a.json, field.name) as string).toLowerCase()
											: get(a.json, field.name);
									const _b =
										typeof get(b.json, field.name) === 'string'
											? (get(b.json, field.name) as string).toLowerCase()
											: get(b.json, field.name);
									lessThan = lt(_a, _b);
								} else {
									const _a =
										typeof a.json[field.name] === 'string'
											? (a.json[field.name] as string).toLowerCase()
											: a.json[field.name];
									const _b =
										typeof b.json[field.name] === 'string'
											? (b.json[field.name] as string).toLowerCase()
											: b.json[field.name];
									lessThan = lt(_a, _b);
								}
								if (lessThan) {
									result = -1 * field.dir;
								} else {
									result = 1 * field.dir;
								}
								break;
							}
						}
						return result;
					});
				} else {
					const code = this.getNodeParameter('code', 0) as string;
					const regexCheck = /\breturn\b/g.exec(code);

					if (regexCheck?.length) {
						const sandbox = {
							newItems,
						};
						const mode = this.getMode();
						const options = {
							console: mode === 'manual' ? 'redirect' : 'inherit',
							sandbox,
						};
						const vm = new NodeVM(options);

						newItems = await vm.run(
							`
						module.exports = async function() {
							newItems.sort( (a,b) => {
								${code}
							})
							return newItems;
						}()`,
							__dirname,
						);
					} else {
						throw new NodeOperationError(
							this.getNode(),
							`Sort code doesn't return. Please add a 'return' statement to your code`,
						);
					}
				}
				return this.prepareOutputData(newItems);
			} else if (operation === 'limit') {
				let newItems = items;
				const maxItems = this.getNodeParameter('maxItems', 0) as number;
				const keep = this.getNodeParameter('keep', 0) as string;

				if (maxItems > items.length) {
					return this.prepareOutputData(newItems);
				}

				if (keep === 'firstItems') {
					newItems = items.slice(0, maxItems);
				} else {
					newItems = items.slice(items.length - maxItems, items.length);
				}
				return this.prepareOutputData(newItems);
			} else {
				throw new NodeOperationError(this.getNode(), `Operation '${operation}' is not recognized`);
			}
		} else {
			throw new NodeOperationError(this.getNode(), `Resource '${resource}' is not recognized`);
		}
	}
}

const compareItems = (
	obj: INodeExecutionData,
	obj2: INodeExecutionData,
	keys: string[],
	disableDotNotation: boolean,
	_node: INode,
) => {
	let result = true;
	for (const key of keys) {
		if (!disableDotNotation) {
			if (!isEqual(get(obj.json, key), get(obj2.json, key))) {
				result = false;
				break;
			}
		} else {
			if (!isEqual(obj.json[key], obj2.json[key])) {
				result = false;
				break;
			}
		}
	}
	return result;
};

const flattenKeys = (obj: IDataObject, path: string[] = []): IDataObject => {
	return !isObject(obj)
		? { [path.join('.')]: obj }
		: reduce(obj, (cum, next, key) => merge(cum, flattenKeys(next as IDataObject, [...path, key])), {}); //prettier-ignore
};

const shuffleArray = (array: any[]) => {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[array[i], array[j]] = [array[j], array[i]];
	}
};

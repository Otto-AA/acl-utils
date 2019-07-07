import Agents from './Agents'
import Permissions from './Permissions'
import AclRule from './AclRule'
import AclParser from './AclParser'

/**
 * @module AclDoc
 */
// /** @typedef {import("n3").Quad} Quad */

/**
 * @typedef {object} AclDocOptions
 * @property {string} [defaultAccessTo] - Url to the file/folder which will be granted access to
 */

/**
 * @description Class for storing information of an acl file
 * @alias module:AclDoc
 * @example
 * // Create a new AclDoc
 * // We can specify a default accessTo value here. If not specified we will need to add it to the AclRule's
 * const { READ } = Permissions
 * const webId = 'https://solid.example.org/profile/card#me'
 *
 * const doc = new AclDoc({ defaultAccessTo: 'https://solid.example.org/foo/file.ext' })
 *
 * // Give one user all permissions (READ, WRITE, APPEND and CONTROL)
 * // We can add a subjectId, else it will be generated automatically
 * doc.addRule(new AclRule(Permissions.ALL, webId), '#owner')
 *
 * // Give everyone read access
 * doc.addRule(new AclRule(READ, Agents.PUBLIC))
 *
 */
class AclDoc {
  /**
   * @param {AclDocOptions} [options]
   */
  constructor (options = {}) {
    this.defaultAccessTo = options.defaultAccessTo

    /** @type {Object.<string, AclRule>} */
    this.rules = {}
    /** @type {Quad[]} */
    this.otherQuads = []
  }

  /**
   * @param {Permissions} permissions
   * @param {Agents} agents
   * @param {string} [accessTo]
   * @param {string} [subjectId]
   * @example
   * const rule = new AclRule(new Permissions(READ, WRITE), new Agents('https://my.web.id/#me'))
   * doc.addRule(rule)
   * // addRule uses AclRule.from which means we could use following too
   * doc.addRule([READ, WRITE], 'https://my.web.id/#me')
   */
  addRule (permissions, agents, accessTo, subjectId) {
    const rule = this._ruleFromArgs(permissions, agents, accessTo)

    subjectId = subjectId || this._getNewSubjectId()
    this.rules[subjectId] = rule
  }

  /**
   * @param {AclRule} rule
   * @returns {boolean} true if this combination of these agents have the permissions for the accessTo file
   * @example
   * doc.addRule([READ, WRITE], ['https://first.web.id', 'https://second.web.id'])
   * doc.hasRule(READ, 'https://first.web.id') // true
   * doc.hasRule([READ, WRITE], ['https://first.web.id', 'https://second.web.id']) // true
   * doc.hasRule(CONTROL, 'https://first.web.id') // false
   * doc.hasRule(READ, 'https://third.web.id') // false
   */
  hasRule (...args) {
    // rulesToCheck contains all semi rules which aren't found yet
    let rulesToCheck = [ this._ruleFromArgs(...args) ]

    for (const r of Object.values(this.rules)) {
      const newRulesToCheck = []
      while (rulesToCheck.length) {
        const rule = rulesToCheck.pop()
        newRulesToCheck.push(...AclRule.subtract(rule, r))
      }
      rulesToCheck = newRulesToCheck

      if (rulesToCheck.length === 0) {
        return true
      }
    }

    return false
  }

  /**
   * @param {AclRule} rule
   * @example
   * doc.addRule([READ, WRITE], ['https://first.web.id', 'https://second.web.id'])
   * doc.deleteRule(READ, 'https://first.web.id')
   * doc.hasRule(READ, 'https://first.web.id') // false
   * doc.hasRule(WRITE, 'https://first.web.id') // true
   * doc.hasRule([READ, WRITE], 'https://second.web.id') // true
   */
  deleteRule (...args) {
    const toDelete = this._ruleFromArgs(...args)

    for (const subjectId of Object.keys(this.rules)) {
      this.deleteBySubject(subjectId, toDelete)
    }
  }

  /**
   * @param {string} subjectId
   * @param {AclRule} [rule] - if not specified it will delete the entire subject group
   */
  deleteBySubject (subjectId, rule) {
    if (this.rules.hasOwnProperty(subjectId)) {
      if (!rule) {
        // Delete whole subject group
        delete this.rules[subjectId]
      } else {
        // Delete only specific combination of permissions and agents
        // If necessary, split up into two new subject ids
        const prevRule = this.rules[subjectId]
        const newRules = AclRule.subtract(prevRule, rule)

        if (newRules.length === 1) {
          this.rules[subjectId] = newRules[0]
        } else {
          delete this.rules[subjectId]

          for (const newRule of newRules) {
            const newSubjectId = this._getNewSubjectId(subjectId)
            this.rules[newSubjectId] = newRule
          }
        }
      }
    }
  }

  /**
   * @param {Agents} agents
   * @example
   * // Remove all permissions for one specific webId and public
   * const agents = new Agents()
   * agents.addWebId('https://web.id')
   * agents.addPublic()
   * doc.deleteAgents(agents)
   */
  deleteAgents (agents) {
    this.deleteRule(new AclRule(Permissions.ALL, agents))
  }

  /**
   * @param {Permissions} permissions
   * @example
   * // Set that no one (!) will be able to use APPEND on this resource
   * // Do not use this with CONTROL, except if you are sure you want that
   * doc.deletePermissions(APPEND)
   */
  deletePermissions (permissions) {
    permissions = Permissions.from(permissions)

    for (const [subjectId, rule] of Object.entries(this.rules)) {
      const toDelete = new AclRule(permissions, rule.agents)
      this.deleteBySubject(subjectId, toDelete)
    }
  }

  /**
   * @description Get all permissions a specific group of agents has
   * Ignores accessTo
   * @param {Agents} agents
   * @returns {Permissions}
   * @example
   * // Check if a specific user has READ permissions
   * const agents = new Agents('https://web.id')
   * const permissions = doc.getPermissionsFor(agents)
   * permissions.has(READ) // true if the user has read permissions
   */
  getPermissionsFor (agents) {
    agents = Agents.from(agents)

    return Object.values(this.rules)
      .filter(rule => rule.agents.includes(agents))
      .map(rule => rule.permissions)
      .reduce(Permissions.merge) // TODO: Check if this works
  }

  /**
   * @param {Permissions} permissions
   * @returns {Agents}
   * @example
   * // Get all agents which have WRITE permissions
   * const permissions = new Permissions(WRITE)
   * const agents = doc.getAgentsWith(permissions)
   * agents.hasWebId('https://web.id') // true if this user has write permissions
   * agents.hasPublic() // true if everyone has write permissions
   * // You can iterate over the webIds set if you want to list them all
   * [...agents.webIds].forEach(webId => console.log(webId))
   */
  getAgentsWith (permissions) {
    permissions = Permissions.from(permissions)

    return Object.values(this.rules)
      .filter(rule => rule.permissions.includes(permissions))
      .map(rule => rule.agents)
      .reduce(Agents.merge) // TODO: Check if this works
  }

  /**
   * @description Use this to get all rules for converting to turtle
   * @returns {Object.<string, AclRule>}
   */
  getMinifiedRules () {
    // TODO
    for (const [subjectId, rule] of Object.entries(this.rules)) {
      if (rule.hasNoEffect()) {
        delete this.rules[subjectId]
      }
    }
    return this.rules
  }

  /**
   * @description add data which isn't an access restriction
   * @param {Quad} other
   */
  addOther (other) {
    this.otherQuads.push(other)
  }

  /**
   * @description Create the turtle representation for this acl document
   * @example
   * // TODO: Test if this works
   * // Update the acl file
   * const turtle = doc.toTurtle()
   * solid.auth.fetch(aclUrl, {
   *   method: 'PUT',
   *   body: turtle
   * })
   */
  toTurtle () {
    const parser = new AclParser()
    return parser.aclDocToTurtle(this)
  }

  /**
   * @param {string} subjectId
   * @param {AclRule} rule
   */

  /**
   * @returns {AclRule}
   */
  _ruleFromArgs (permission, agents, accessTo) {
    const rule = AclRule.from(permission, agents, accessTo)
    if (!rule.accessTo.length) {
      rule.accessTo.push(this._getDefaultAccessTo())
    }
    return rule
  }

  /**
   * @returns {string}
   */
  _getDefaultAccessTo () {
    if (!this.defaultAccessTo) {
      throw new Error('The accessTo value must be specified in the constructor options or directly when calling the methods')
    }
    return this.defaultAccessTo
  }

  /**
   * @description Get an unused subject id
   * @param {string} [base='new-acl-rule'] - The newly generated id will begin with this base id
   * @returns {string}
   */
  _getNewSubjectId (base = 'new-acl-rule-1') {
    let index = Number(base.match(/[\d]*$/)[0]) // Last positive number; 0 if not ending with number
    base = base.replace(/[\d]*$/, '')

    while (this.rules.hasOwnProperty(base + index)) {
      index++
    }
    return base + index
  }
}

export default AclDoc

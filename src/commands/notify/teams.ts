const childProcess = require('child_process')
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { HttpClient } from '../../utils/HttpClient';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-notify', 'teams');

interface Item {
  number?: string,
  name?: string,
  type?: string
}

interface Fact {
  name?: string,
  value?: string
}

export default class Teams extends SfdxCommand {

  public static description = messages.getMessage('commandDescription');

  public static examples = [
  `$ sfdx notify:teams --from 5.0 --to HEAD -u https://outlook.office.com/webhook/WEBHOOK_URL -e UAT -b $BITBUCKET_BRANCH
  Notify deployment status on Microsoft Teams... Done!
  `
  ];

  public static args = [{name: 'Notify'}];

  protected static flagsConfig = {
    path: flags.string({char: 'p', description: messages.getMessage('pathFlagDescription')}),
    url: flags.string({char: 'u', description: messages.getMessage('urlFlagDescription')}),
    env: flags.string({char: 'e', description: messages.getMessage('envFlagDescription')}),
    branch: flags.string({char: 'b', description: messages.getMessage('branchFlagDescription')}),
    from: flags.string({char: 'f', description: messages.getMessage('fromFlagDescription')}),
    to: flags.string({char: 't', description: messages.getMessage('toFlagDescription')}),
    casesensitive: flags.string({char: 'c', description: messages.getMessage('casesensitiveFlagDescription')}),
    regex: flags.string({char: 'r', description: messages.getMessage('regexFlagDescription')})
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  public async run(): Promise<AnyJson> {

    if(this.flags.path === undefined){
      this.ux.warn('Path parameter is empty, using "." instead.');
      this.flags.path = '.';
    }
    if(this.flags.to === undefined){
      this.ux.warn('To parameter is empty, using "HEAD" instead.');
      this.flags.to = 'HEAD';
    }
    if(this.flags.env === undefined){
      this.ux.warn('Env parameter is empty, using "current environment" instead.');
      this.flags.env = 'current environment';
    }
    if(this.flags.branch === undefined){
      this.ux.warn('Branch parameter is empty, using "Current branch" instead.');
      this.flags.branch = 'Current branch';
    }

    if(this.flags.url === undefined || this.flags.from === undefined || this.flags.to === undefined){
      throw new Error(
        'One (or more) of the mandatory parameters is missing (url/from/to/branch)'
      );
    }

    const { stdout: log, stderr: err } = childProcess.spawnSync(
      'git',
      ['log', this.flags.from + '..' + this.flags.to, '--oneline'],
      { cwd: this.flags.path, encoding: 'utf8' }
    );

    if(err != ''){
      throw new Error(
        'Git log didn\'t return anything. \Error: ' + err
      );
    }

    let regexParams = 'g';
    if(this.flags.casesensitive !== undefined && !this.flags.casesensitive){
      regexParams += 'i';
    }
    let regex = '[0-9]{5,} \\/ (Feature|Fix).*';
    if(this.flags.regex !== undefined){
      regex = this.flags.regex;
    }
    let pattern = new RegExp(regex, regexParams);
    let matches = log.match(pattern);

    // Construct Microsoft Teams Card Data
    let features = new Array();
    let fixes = new Array();
    for(let match of matches){
      // Remove technical tags
      match = match.replace('[ci skip]','');
      let matchParts = match.split('/');

      let item: Item = {};
      
      item.number = matchParts[0] !== undefined ? matchParts[0].trim() : '';
      item.name = matchParts[2] !== undefined ? matchParts[2].trim() : '';
      item.type = 'fix'; // Default value

      if(matchParts[1] !== undefined){
        if(matchParts[1].includes('Feature')){
          item.type = 'feature';
          features.push(item);
        }else{
          fixes.push(item);
        }
      }
    }

    let facts = new Array();
    let firstFeature = true;
    let firstDefect = true;

    for(let feature of features){
      let fact: Fact = {};
      fact.name = '';
      if(firstFeature){
          fact.name = 'User Stories:';
      }
      fact.value = '**' + feature.number + '** - ' + feature.name;
      facts.push(fact);

      firstFeature = false;
    }

    for(let fix of fixes){
      let fact: Fact = {};
      fact.name = '';
      if(firstDefect){
          fact.name = 'Defects:';
      }
      fact.value = '**' + fix.number + '** - ' + fix.name;
      facts.push(fact);

      firstDefect = false;
    }

    let data = 
    {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        "themeColor": "0076D7",
        "summary": this.flags.branch + " deployed",
        "sections": [{
            "activityTitle": this.flags.branch + " deployed",
            "activitySubtitle": "on " + this.flags.env,
            "facts": facts,
            "markdown": true
        }]
    };

    this.ux.startSpinner('Notify deployment status on Microsoft Teams');
    await HttpClient.sendRequest(this.flags.url, data);
    this.ux.stopSpinner('Done!');

    // Return an object to be displayed with --json
    return data;
  }
}

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
  `$ sfdx notify:teams -u https://outlook.office.com/webhook/WEBHOOK_URL -e UAT -b $BITBUCKET_BRANCH
  Notify deployment status on Microsoft Teams... Done!
  `
  ];

  public static args = [{name: 'Notify'}];

  protected static flagsConfig = {
    url: flags.string({char: 'u', description: messages.getMessage('urlFlagDescription')}),
    env: flags.string({char: 'e', description: messages.getMessage('envFlagDescription')}),
    branch: flags.string({char: 'b', description: messages.getMessage('branchFlagDescription')})
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  public async run(): Promise<AnyJson> {
    const { stdout: log } = childProcess.spawnSync(
      'git',
      ['log', '5.0..HEAD', '--oneline'],
      { cwd: '/Users/gavignon/dev/CMA CGM/Git', encoding: 'utf8' }
    );

    let pattern = /[0-9]{5,} \/ (Feature|Fix).*/g;
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

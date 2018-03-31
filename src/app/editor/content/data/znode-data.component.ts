/*
 * Copyright (C) 2018  Ľuboš Kozmon
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import {AfterViewInit, Component, OnInit, ViewChild, ViewContainerRef} from "@angular/core";
import {ActivatedRoute} from "@angular/router";
import {AceEditorComponent} from "ng2-ace-editor";
import {Observable} from "rxjs/Rx";
import {Either} from "tsmonad";
import "brace";
import "brace/ext/searchbox";
import "brace/mode/text";
import "brace/mode/json";
import "brace/mode/yaml";
import "brace/mode/xml";
import "brace/theme/chrome";
import {DialogService, ZNode, ZNodeService, ZNodeWithChildren} from "../../../core";
import {CanDeactivateComponent} from "../../../shared";
import {PreferencesService} from "../../preferences";
import {EDITOR_QUERY_NODE_PATH} from "../../editor-routing.constants";
import {ZPathService} from "../../../core/zpath";
import {Mode} from "../../mode";
import {FormatterProvider, Formatter} from "../../formatter";

@Component({
  templateUrl: "znode-data.component.html",
  styleUrls: ["znode-data.component.scss"]
})
export class ZNodeDataComponent implements OnInit, AfterViewInit, CanDeactivateComponent {

  @ViewChild("dataEditor") editor: AceEditorComponent;

  defaultMode: Mode = Mode.Text;

  currentPath: Observable<string>;

  editorData: string;
  editorModes: Mode[] = [
    Mode.Text,
    Mode.Json,
    Mode.Yaml,
    Mode.Xml
  ];
  editorMode: Mode = this.defaultMode;
  editorOpts: any = {
    fontSize: "10pt",
    wrap: true
  };

  zNode: ZNode;

  constructor(
    private route: ActivatedRoute,
    private zNodeService: ZNodeService,
    private zPathService: ZPathService,
    private dialogService: DialogService,
    private preferencesService: PreferencesService,
    private formatterProvider: FormatterProvider,
    private viewContainerRef: ViewContainerRef
  ) {
  }

  get editorDirty(): boolean {
    if (!this.zNode) {
      return false;
    }

    return this.editorData !== this.zNode.data;
  }

  ngOnInit(): void {
    (<Observable<Either<Error, ZNodeWithChildren>>> this.route.parent.data.pluck("zNodeWithChildren"))
      .forEach(either =>
        either.caseOf<void>({
          left: error => {
            this.dialogService.showError(error.message, this.viewContainerRef);
            this.zNode = null;
          },
          right: node => this.updateData(node)
        })
      );

    this.currentPath = this.route
      .queryParamMap
      .map(a =>
        this.zPathService
          .parse(a.get(EDITOR_QUERY_NODE_PATH) || "/")
          .path
      );

    // Try to recall mode used the last time with this node
    this.currentPath
      .concatMap(m => this.preferencesService.getModeFor(m))
      .map(m => m.valueOr(this.defaultMode))
      .forEach(mode => this.editorMode = mode);
  }

  ngAfterViewInit(): void {
    // Check if editor exists since its guarded by ngIf
    if (this.editor) {
      // Disable Ace editors search box
      this.editor
        ._editor
        .commands
        .removeCommand("find");
    }
  }

  canDeactivate(): Observable<boolean> | Promise<boolean> | boolean {
    if (this.editorDirty) {
      return this.dialogService
        .showDiscardChanges(this.viewContainerRef)
        .switchMap(ref => ref.afterClosed());
    }

    return Observable.of(true);
  }

  onSubmit(): void {
    const newData = this.editorData;

    this.zNodeService
      .setData(
        this.currentPathSnapshot,
        this.zNode.meta.dataVersion,
        newData
      )
      .map(newMeta => {
        const newNode: ZNode = {
          acl: this.zNode.acl,
          path: this.zNode.path,
          data: newData,
          meta: newMeta
        };

        this.updateData(newNode);
      })
      .switchMap(() =>
        this.dialogService
          .showSnackbar("Changes saved", this.viewContainerRef)
          .switchMap(ref => ref.afterOpened())
      )
      .catch(err => this.dialogService.showErrorAndThrowOnClose(err, this.viewContainerRef))
      .subscribe();
  }

  onKeyDown(event: KeyboardEvent): void {
    const code = event.which || event.keyCode;

    if (!(code === 115 && event.ctrlKey) && code !== 19) {
      return;
    }

    // Submit on CTRL + S
    event.preventDefault();
    this.onSubmit();
  }

  formatData(): void {
    this.formatterProvider
      .getFormatter(this.editorMode)
      .map<Either<Error, Formatter>>(Either.right)
      .valueOrCompute(() => Either.left<Error, Formatter>(
        new Error("Unsupported mode '" + this.editorMode.toUpperCase() + "'")
      ))
      .bind((f: Formatter) => f.format(this.editorData))
      .caseOf({
        left: error => {
          this.dialogService
            .showSnackbar("Error:  " + error.message, this.viewContainerRef)
            .subscribe()
        },
        right: data => this.editorData = data
      });
  }

  get formatterAvailable(): boolean {
    return this.formatterProvider
      .getFormatter(this.editorMode)
      .caseOf({
        just: () => true,
        nothing: () => false
      });
  }

  toggleWrap(): void {
    this.editorOpts.wrap = !this.editorOpts.wrap;
    this.updateOpts();
  }

  switchMode(mode: Mode): void {
    // Remember mode used for this node
    this.preferencesService
      .setModeFor(this.currentPathSnapshot, mode)
      .subscribe();

    this.editorMode = mode;
  }

  private updateOpts(): void {
    this.editor.setOptions(this.editorOpts);
  }

  private updateData(node: ZNode): void {
    this.zNode = node;
    this.editorData = node.data;
  }

  private get currentPathSnapshot(): string | null {
    return this.zPathService
      .parse(this.route.snapshot.queryParamMap.get(EDITOR_QUERY_NODE_PATH) || "/")
      .path;
  }
}

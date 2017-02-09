// ==UserScript==
// @name        SRES reporter
// @namespace   https://
// @description Generates a .CSV download of the class list and access report for all students
// @include     https://canvas.auckland.ac.nz/courses/*/users
// @version     2.1
// @grant       none
// ==/UserScript==
requirejs(['https://cdn.rawgit.com/eligrey/FileSaver.js/master/FileSaver.js'], function () {
  'use strict';
  var userData = {
  };
  var accessData = [
  ];
  var pending = - 1;
  var fetched = 0;
  var needsFetched = 0;
  var reporttype;
  var ajaxPool;
  var today = new Date();
  var dd = today.getDate();
  var mm = today.getMonth() + 1;
  var yyyy = today.getFullYear();
  if (dd < 10) {
    dd = '0' + dd;
  }
  if (mm < 10) {
    mm = '0' + mm;
  }
  var today = dd + '-' + mm + '-' + yyyy;
  var aborted = false;
  addAccessReportButton();
  function addAccessReportButton() {
    if ($('#jj_student_report').length === 0) {
      $('#people-options > ul').append('<li class="ui-menu-item" role="presentation" tabindex="-1"><a id="jj_student_report" class="ui-corner-all" role="menuitem"><i class="icon-analytics"></i> SRES student list</a></li>');
      $('#jj_student_report').one('click', {
        type: 1
      }, accessReport);
    }
    if ($('#jj_access_report').length === 0) {
      $('#people-options > ul').append('<li class="ui-menu-item" role="presentation" tabindex="-2"><a id="jj_access_report" class="ui-corner-all" role="menuitem"><i class="icon-analytics"></i> SRES access data</a></li>');
      $('#jj_access_report').one('click', {
        type: 0
      }, accessReport);
    }
    return;
  }
  function abortAll() {
    for (var i = 0; i < ajaxPool.length; i++) {
      ajaxPool[i].abort();
    }
    ajaxPool = [
    ];
  }
  function setupPool() {
    try {
      ajaxPool = [
      ];
      $.ajaxSetup({
        'beforeSend': function (jqXHR) {
          ajaxPool.push(jqXHR);
        },
        'complete': function (jqXHR) {
          var i = ajaxPool.indexOf(jqXHR);
          if (i > - 1) {
            ajaxPool.splice(i, 1);
          }
        }
      });
    } catch (e) {
      throw new Exception('Error configuring AJAX pool');
    }
  }
  function accessReport(e) { //gets the student list
    reporttype = e.data.type;
    aborted = false;
    setupPool();
    var courseId = getCourseId();
    var url = '/api/v1/courses/' + courseId + '/sections?include[]=students&include[]=email&per_page=100';
    progressbar();
    pending = 0;
    getStudents(courseId, url);
  }
  function nextURL(linkTxt) { //if more than 100 students, gets the URL for the rest of the list
    var url = null;
    if (linkTxt) {
      var links = linkTxt.split(',');
      var nextRegEx = new RegExp('^<(.*)>; rel="next"$');
      for (var i = 0; i < links.length; i++) {
        var matches = nextRegEx.exec(links[i]);
        if (matches) {
          url = matches[1];
        }
      }
    }
    return url;
  }
  function getStudents(courseId, url) { //cycles through the student list
    try {
      if (aborted) {
        throw new Error('Aborted');
      }
      pending++;
      $.getJSON(url, function (udata, status, jqXHR) {
        url = nextURL(jqXHR.getResponseHeader('Link'));
        for (var i = 0; i < udata.length; i++) {
          var section = udata[i];
          if (section.students.length > 0) {
            for (var j = 0; j < section.students.length; j++) {
              var user = section.students[j];
              user.section_id = section.id;
              user.section_name = section.name;
              user.sis_section_id = section.sis_section_id;
              user.sis_course_id = section.sis_course_id;
              var splitname = user.sortable_name.split(',');
              user.firstname = splitname[1].trim();
              user.surname = splitname[0].trim();
              userData[user.id] = user;
            }
          }
        }
        if (url) {
          getStudents(courseId, url);
        }
        pending--;
        if (pending <= 0) {
          if (reporttype == 0) { //branches to get student access data
            getAccessReport(courseId);
          }
          if (reporttype == 1) {
            makeReport();
          }
        }
      }).fail(function () {
        pending--;
        throw new Error('Failed to load list of students');
      });
    } catch (e) {
      errorHandler(e);
    }
  }
  function getAccessReport(courseId) { //cycles through student list
    pending = 0;
    fetched = 0;
    needsFetched = Object.getOwnPropertyNames(userData).length;
    for (var id in userData) {
      if (userData.hasOwnProperty(id)) {
        var url = '/courses/' + courseId + '/users/' + id + '/usage.json?per_page=100';
        getAccesses(courseId, url);
      }
    }
  }
  function getAccesses(courseId, url) { //gets usage data for each student individually
    try {
      if (aborted) {
        throw new Error('Aborted');
      }
      pending++;
      $.getJSON(url, function (adata, status, jqXHR) {
        url = nextURL(jqXHR.getResponseHeader('Link'));
        accessData.push.apply(accessData, adata);
        if (url) {
          getAccesses(courseId, url);
        }
        pending--;
        fetched++;
        progressbar(fetched, needsFetched);
        if (pending <= 0 && !aborted) {
          makeReport();
        }
      }).fail(function () {
        pending--;
        fetched++;
        progressbar(fetched, needsFetched);
        if (!aborted) {
          console.log('Some access report data failed to load');
        }
      });
    } catch (e) {
      errorHandler(e);
    }
  }
  function getCourseId() { //identifies course ID from URL
    var courseId = null;
    try {
      var courseRegex = new RegExp('/courses/([0-9]+)');
      var matches = courseRegex.exec(window.location.href);
      if (matches) {
        courseId = matches[1];
      } else {
        throw new Error('Unable to detect Course ID');
      }
    } catch (e) {
      errorHandler(e);
    }
    return courseId;
  }
  function makeReport() { //generates CSV of data
    try {
      if (aborted) {
        console.log('Process aborted');
        aborted = false;
        return;
      }
      progressbar();
      var csv = createCSV();
      if (csv) {
        var blob = new Blob([csv], {
          'type': 'text/csv;charset=utf-8'
        });
        if (reporttype == 0) {
          saveAs(blob, 'SRES-access-report-' + today + '.csv');
          $('#jj_access_report').one('click', {
            type: 0
          }, accessReport);
        }
        if (reporttype == 1) {
          var savename = 'SRES-student-list-' + today + '.csv';
          saveAs(blob, savename);
          $('#jj_student_report').one('click', {
            type: 1
          }, accessReport);
        }
      } else {
        throw new Error('Problem creating report');
      }
    } catch (e) {
      errorHandler(e);
    }
  }
  function createCSV() {
    var fields = [
      {
        'name': 'UoA Username',
        'src': 'u.login_id',
        'sis': true
      },
      {
        'name': 'First name',
        'src': 'u.firstname'
      },
      {
        'name': 'Surname',
        'src': 'u.surname'
      },
      {
        'name': 'Email',
        'src': 'u.email'
      },
      {
        'name': 'Canvas User ID',
        'src': 'u.id'
      },
      {
        'name': 'Display Name',
        'src': 'u.name'
      },
      {
        'name': 'Sortable Name',
        'src': 'u.sortable_name'
      },
      {
        'name': 'Category',
        'src': 'a.asset_category',
        'accessing': true
      },
      {
        'name': 'Class',
        'src': 'a.asset_class_name',
        'accessing': true
      },
      {
        'name': 'Title',
        'src': 'a.readable_name',
        'accessing': true
      },
      {
        'name': 'Views by ' + today,
        'src': 'a.view_score',
        'accessing': true
      },
      {
        'name': 'Participations by ' + today,
        'src': 'a.participate_score',
        'accessing': true
      },
      {
        'name': 'Last Access',
        'src': 'a.last_access',
        'fmt': 'date',
        'accessing': true
      },
      {
        'name': 'First Access',
        'src': 'a.created_at',
        'fmt': 'date',
        'accessing': true
      },
      {
        'name': 'Action',
        'src': 'a.action_level',
        'accessing': true
      },
      {
        'name': 'Code',
        'src': 'a.asset_code',
        'accessing': true
      },
      {
        'name': 'Group Code',
        'src': 'a.asset_group_code',
        'accessing': true
      },
      {
        'name': 'Context Type',
        'src': 'a.context_type',
        'accessing': true
      },
      {
        'name': 'Context ID',
        'src': 'a.context_id',
        'accessing': true
      },
      {
        'name': 'SIS Login ID',
        'src': 'u.sis_login_id'
      },
      {
        'name': 'Section',
        'src': 'u.section_name',
      },
      {
        'name': 'Section ID',
        'src': 'u.section_id',
      },
      {
        'name': 'SIS Course ID',
        'src': 'u.sis_course_id',
        'sis': true
      },
      {
        'name': 'SIS Section ID',
        'src': 'u.sis_section_id',
        'sis': true
      },
      {
        'name': 'SIS User ID',
        'src': 'u.sis_user_id',
        'sis': true
      }
    ];
    var canSIS = false;
    for (var id in userData) {
      if (userData.hasOwnProperty(id)) {
        if (typeof userData[id].sis_user_id !== 'undefined' && userData[id].sis_user_id) {
          canSIS = true;
          break;
        }
      }
    }
    var CRLF = '\r\n';
    var hdr = [
    ];
    fields.map(function (e) {
      if (typeof e.sis === 'undefined' || (e.sis && canSIS)) {
        if (typeof e.accessing === 'undefined' || e.accessing && reporttype == 0) {
          hdr.push(e.name);
        }
      }
    });
    var t = hdr.join(',') + CRLF;
    var item,
    user,
    userId,
    fieldInfo,
    value;
    if (reporttype == 0) {
      for (var i = 0; i < accessData.length; i++) {
        item = accessData[i].asset_user_access;
        userId = item.user_id;
        user = userData[userId];
        for (var j = 0; j < fields.length; j++) {
          if (typeof fields[j].sis !== 'undefined' && fields[j].sis && !canSIS) {
            continue;
          }
          fieldInfo = fields[j].src.split('.');
          value = fieldInfo[0] == 'a' ? item[fieldInfo[1]] : user[fieldInfo[1]];
          if (value === null) {
            value = '';
          } else {
            if (typeof fields[j].fmt !== 'undefined') {
              switch (fields[j].fmt) {
                case 'date':
                  value = excelDate(value);
                  break;
                default:
                  break;
              }
            }
            if (typeof value === 'string') {
              var quote = false;
              if (value.indexOf('"') > - 1) {
                value = value.replace(/"/g, '""');
                quote = true;
              }
              if (value.indexOf(',') > - 1) {
                quote = true;
              }
              if (quote) {
                value = '"' + value + '"';
              }
            }
          }
          if (j > 0) {
            t += ',';
          }
          t += value;
        }
        t += CRLF;
      }
    }
    if (reporttype == 1) {
      for (var id in userData) {
        item = userData[id];
        userId = item.id;
        user = userData[userId];
        for (var j = 0; j < fields.length; j++) {
          if (typeof fields[j].sis !== 'undefined' && fields[j].sis && !canSIS) {
            continue;
          }
          if (typeof fields[j].accessing !== 'undefined' && fields[j].accessing) {
            continue;
          }
          fieldInfo = fields[j].src.split('.');
          value = fieldInfo[0] == 'a' ? item[fieldInfo[1]] : user[fieldInfo[1]];
          if (value === null) {
            value = '';
          } else {
            if (typeof fields[j].fmt !== 'undefined') {
              switch (fields[j].fmt) {
                case 'date':
                  value = excelDate(value);
                  break;
                default:
                  break;
              }
            }
            if (typeof value === 'string') {
              var quote = false;
              if (value.indexOf('"') > - 1) {
                value = value.replace(/"/g, '""');
                quote = true;
              }
              if (value.indexOf(',') > - 1) {
                quote = true;
              }
              if (quote) {
                value = '"' + value + '"';
              }
            }
          }
          if (j > 0) {
            t += ',';
          }
          t += value;
        }
        t += CRLF;
      }
    }
    return t;
  }
  function excelDate(timestamp) {
    var d;
    try {
      if (!timestamp) {
        return '';
      }
      timestamp = timestamp.replace('Z', '.000Z');
      var dt = new Date(timestamp);
      if (typeof dt !== 'object') {
        return '';
      }
      d = dt.getFullYear() + '-' + pad(1 + dt.getMonth()) + '-' + pad(dt.getDate()) + ' ' + pad(dt.getHours()) + ':' + pad(dt.getMinutes()) + ':' + pad(dt.getSeconds());
    } catch (e) {
      errorHandler(e);
    }
    return d;
    function pad(n) {
      return n < 10 ? '0' + n : n;
    }
  }
  function progressbar(x, n) {
    try {
      if (typeof x === 'undefined' || typeof n == 'undefined') {
        if ($('#jj_progress_dialog').length === 0) {
          $('body').append('<div id="jj_progress_dialog"></div>');
          $('#jj_progress_dialog').append('<div id="jj_progressbar"></div>');
          $('#jj_progress_dialog').dialog({
            'title': 'Fetching Report',
            'autoOpen': false,
            'buttons': [
              {
                'text': 'Cancel',
                'click': function () {
                  $(this).dialog('close');
                  aborted = true;
                  abortAll();
                  pending = - 1;
                  fetched = 0;
                  needsFetched = 0;
                  if (reporttype == 0) {
                    $('#jj_access_report').one('click', {
                      type: 0
                    }, accessReport);
                  }
                  if (reporttype == 1) {
                    $('#jj_student_report').one('click', {
                      type: 1
                    }, accessReport);
                  }
                }
              }
            ]
          });
        }
        if ($('#jj_progress_dialog').dialog('isOpen')) {
          $('#jj_progress_dialog').dialog('close');
        } else {
          $('#jj_progressbar').progressbar({
            'value': false
          });
          $('#jj_progress_dialog').dialog('open');
        }
      } else {
        if (!aborted) {
          var val = n > 0 ? Math.round(100 * x / n)  : false;
          $('#jj_progressbar').progressbar('option', 'value', val);
        }
      }
    } catch (e) {
      errorHandler(e);
    }
  }
  function errorHandler(e) {
    console.log(e.name + ': ' + e.message);
  }
}) ();
